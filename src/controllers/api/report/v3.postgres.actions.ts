import bluebird from 'bluebird'
import { and, eq, sql, type SQL } from 'drizzle-orm'
import { type AnyPgColumn } from 'drizzle-orm/pg-core'
import { type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { ZodError } from 'zod'

import {
  createAvailabilityKey,
  createCostKey,
  createItemImprovementRecipeRecordSchema,
  createUpdateKey,
  getItemImprovementRecipeValidationErrorMessage,
  getReporterOrigin,
  isItemImprovementValidationError,
  normalizeItemImprovementRecipeRecord,
  parseExportCursor,
  parseItemImprovementRecipeData,
  type ExportCursor,
  type ItemImprovementRecipeDetailRecord,
  type ItemImprovementRecipeExecutionRecord,
  type ItemImprovementRecipeListRecord,
  type ItemImprovementRecipeRecord,
} from '../../../contracts/item-improvement-recipe'
import { logReportValidationIssues } from '../../../contracts/report-validation'
import {
  createQuestHash,
  normalizeQuestReport,
  normalizeQuestRewardReport,
} from '../../../contracts/v3-report'
import * as pgSchema from '../../../db/postgres/schema'
import { withCloudflareCache } from '../../../http/cache-control'
import { type AppRequest } from '../../../http/request'
import { badRequest, internalServerError, ok, type AppResult } from '../../../http/result'
import { type RequiredItem } from '../../../models'
import { captureException } from '../../../sentry'
import { type ReportV3Actions } from './v3.fastify'
import { getRequestData, handleReportError, parseReportInfo } from './shared'

const {
  itemImprovementAvailabilityFacts,
  itemImprovementCostFacts,
  itemImprovementUpdateFacts,
  quests,
  questRewards,
} = pgSchema

type PostgresDb = NodePgDatabase<typeof pgSchema>

// PostgreSQL uses a lower, pool-aware ingest concurrency than MongoDB's (10, see
// v3.mongo.actions.ts) so item-improvement batches leave pool headroom for unrelated concurrent
// requests (docs/postgresql-migration-plan.md: "Item-improvement ingestion concurrency: 5").
const ITEM_IMPROVEMENT_RECIPE_INGEST_CONCURRENCY = 5

// The export settled window: exclude rows newer than 30 seconds before the query's own database
// cutoff so a client can never observe a row while an earlier, still-in-flight write with an
// equal-or-lower `last_reported`/`export_id` pair could still commit (plan's "v3 item-improvement
// compatibility" MVCC section).
const EXPORT_SETTLED_WINDOW_SQL = sql`interval '30 seconds'`

// Database-generated write-time millisecond epoch (see v2.postgres.actions.ts's identical
// `dbTimeMillis`). Every accumulation write derives its timestamp from PostgreSQL's own clock
// inside the statement, never from an application `Date.now()`.
const dbTimeMillis: SQL<number> = sql<number>`(extract(epoch from clock_timestamp()) * 1000)::bigint`

type SqlArrayElementType = 'text' | 'integer'

const toSqlArrayLiteral = (
  values: readonly (string | number)[],
  elementType: SqlArrayElementType,
): SQL => {
  if (values.length === 0) {
    return sql.raw(`array[]::${elementType}[]`)
  }
  return sql`array[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )}]::${sql.raw(`${elementType}[]`)}`
}

// Mongo `$addToSet`/`$each` equivalent: a PostgreSQL stable append-if-absent union. Appends only
// the incoming elements not already present in `column`, in incoming order, after the column's
// existing elements (plan's semantic mapping table). `coalesce(..., array[]::type[])` keeps the
// concatenation a no-op (rather than nulling the column) when nothing new needs to be added.
export const appendDistinctInOrder = (
  column: AnyPgColumn,
  incoming: readonly (string | number)[],
  elementType: SqlArrayElementType,
): SQL =>
  sql`(${column} || coalesce((select array_agg(t.value order by t.ord) from unnest(${toSqlArrayLiteral(incoming, elementType)}) with ordinality as t(value, ord) where not (t.value = any(${column}))), ${toSqlArrayLiteral([], elementType)}))`

// Builds the shared "settled and past the cursor" predicate used by every item-improvement export
// query. `settled.cutoff` refers to the single-row `settled` CTE's `clock_timestamp() - interval
// '30 seconds'` column, materialized once per query (see buildSettledCte below).
const buildExportPredicate = (
  lastReported: AnyPgColumn,
  exportId: AnyPgColumn,
  cursor: ExportCursor,
): SQL =>
  sql`${lastReported} <= (extract(epoch from settled.cutoff) * 1000)::bigint and (${lastReported} > ${cursor.updatedAfter}${
    cursor.afterId == null
      ? sql``
      : sql` or (${lastReported} = ${cursor.updatedAfter} and ${exportId} > ${cursor.afterId})`
  })`

// One-row CTE capturing PostgreSQL's `clock_timestamp()` exactly once per export query.
// `materialized` prevents the planner from inlining this trivial single-column CTE into the main
// scan, which would otherwise re-evaluate the volatile `clock_timestamp()` once per row instead of
// once per query (plan: "Capture one export cutoff from PostgreSQL clock_timestamp() in a one-row
// CTE inside the export query").
const buildSettledCte = (): SQL =>
  sql`with settled as materialized (select clock_timestamp() - ${EXPORT_SETTLED_WINDOW_SQL} as cutoff)`

export const buildAvailabilityExportQuery = (cursor: ExportCursor): SQL => sql`
  ${buildSettledCte()}
  select
    ${itemImprovementAvailabilityFacts.exportId} as export_id,
    ${itemImprovementAvailabilityFacts.key} as key,
    ${itemImprovementAvailabilityFacts.schemaVersion} as schema_version,
    ${itemImprovementAvailabilityFacts.recipeId} as recipe_id,
    ${itemImprovementAvailabilityFacts.itemId} as item_id,
    ${itemImprovementAvailabilityFacts.day} as day,
    ${itemImprovementAvailabilityFacts.firstClientObservedAt} as first_client_observed_at,
    ${itemImprovementAvailabilityFacts.lastClientObservedAt} as last_client_observed_at,
    ${itemImprovementAvailabilityFacts.observedSecondShipId} as observed_second_ship_id,
    ${itemImprovementAvailabilityFacts.observedFlagshipIds} as observed_flagship_ids,
    ${itemImprovementAvailabilityFacts.sources} as sources,
    ${itemImprovementAvailabilityFacts.firstReported} as first_reported,
    ${itemImprovementAvailabilityFacts.lastReported} as last_reported,
    ${itemImprovementAvailabilityFacts.count} as count
  from ${itemImprovementAvailabilityFacts} cross join settled
  where ${buildExportPredicate(itemImprovementAvailabilityFacts.lastReported, itemImprovementAvailabilityFacts.exportId, cursor)}
  order by ${itemImprovementAvailabilityFacts.lastReported} asc, ${itemImprovementAvailabilityFacts.exportId} asc
  limit ${cursor.limit}
`

export const buildCostExportQuery = (cursor: ExportCursor): SQL => sql`
  ${buildSettledCte()}
  select
    ${itemImprovementCostFacts.exportId} as export_id,
    ${itemImprovementCostFacts.key} as key,
    ${itemImprovementCostFacts.schemaVersion} as schema_version,
    ${itemImprovementCostFacts.recipeId} as recipe_id,
    ${itemImprovementCostFacts.itemId} as item_id,
    ${itemImprovementCostFacts.day} as day,
    ${itemImprovementCostFacts.firstClientObservedAt} as first_client_observed_at,
    ${itemImprovementCostFacts.lastClientObservedAt} as last_client_observed_at,
    ${itemImprovementCostFacts.observedSecondShipId} as observed_second_ship_id,
    ${itemImprovementCostFacts.observedFlagshipIds} as observed_flagship_ids,
    ${itemImprovementCostFacts.sources} as sources,
    ${itemImprovementCostFacts.firstReported} as first_reported,
    ${itemImprovementCostFacts.lastReported} as last_reported,
    ${itemImprovementCostFacts.count} as count,
    ${itemImprovementCostFacts.itemLevel} as item_level,
    ${itemImprovementCostFacts.stage} as stage,
    ${itemImprovementCostFacts.fuel} as fuel,
    ${itemImprovementCostFacts.ammo} as ammo,
    ${itemImprovementCostFacts.steel} as steel,
    ${itemImprovementCostFacts.bauxite} as bauxite,
    ${itemImprovementCostFacts.buildkit} as buildkit,
    ${itemImprovementCostFacts.remodelkit} as remodelkit,
    ${itemImprovementCostFacts.certainBuildkit} as certain_buildkit,
    ${itemImprovementCostFacts.certainRemodelkit} as certain_remodelkit,
    ${itemImprovementCostFacts.reqSlotItems} as req_slot_items,
    ${itemImprovementCostFacts.reqUseItems} as req_use_items,
    ${itemImprovementCostFacts.changeFlag} as change_flag
  from ${itemImprovementCostFacts} cross join settled
  where ${buildExportPredicate(itemImprovementCostFacts.lastReported, itemImprovementCostFacts.exportId, cursor)}
  order by ${itemImprovementCostFacts.lastReported} asc, ${itemImprovementCostFacts.exportId} asc
  limit ${cursor.limit}
`

export const buildUpdateExportQuery = (cursor: ExportCursor): SQL => sql`
  ${buildSettledCte()}
  select
    ${itemImprovementUpdateFacts.exportId} as export_id,
    ${itemImprovementUpdateFacts.key} as key,
    ${itemImprovementUpdateFacts.schemaVersion} as schema_version,
    ${itemImprovementUpdateFacts.recipeId} as recipe_id,
    ${itemImprovementUpdateFacts.itemId} as item_id,
    ${itemImprovementUpdateFacts.day} as day,
    ${itemImprovementUpdateFacts.firstClientObservedAt} as first_client_observed_at,
    ${itemImprovementUpdateFacts.lastClientObservedAt} as last_client_observed_at,
    ${itemImprovementUpdateFacts.observedSecondShipId} as observed_second_ship_id,
    ${itemImprovementUpdateFacts.observedFlagshipIds} as observed_flagship_ids,
    ${itemImprovementUpdateFacts.sources} as sources,
    ${itemImprovementUpdateFacts.firstReported} as first_reported,
    ${itemImprovementUpdateFacts.lastReported} as last_reported,
    ${itemImprovementUpdateFacts.count} as count,
    ${itemImprovementUpdateFacts.itemLevel} as item_level,
    ${itemImprovementUpdateFacts.upgradeToItemId} as upgrade_to_item_id,
    ${itemImprovementUpdateFacts.upgradeToItemLevel} as upgrade_to_item_level,
    ${itemImprovementUpdateFacts.upgradeObserved} as upgrade_observed
  from ${itemImprovementUpdateFacts} cross join settled
  where ${buildExportPredicate(itemImprovementUpdateFacts.lastReported, itemImprovementUpdateFacts.exportId, cursor)}
  order by ${itemImprovementUpdateFacts.lastReported} asc, ${itemImprovementUpdateFacts.exportId} asc
  limit ${cursor.limit}
`

// Raw node-postgres row shapes. BIGINT (`int8`) columns are driver-parsed as strings (no
// `pg.types.setTypeParser` override exists in this codebase), so every timestamp/count field below
// is a string on the wire and must be explicitly converted with `Number(...)` before it reaches
// the JSON response (plan's testing strategy: "BIGINT timestamp columns returning JSON numbers,
// not node-postgres int8 strings"). `integer[]`/`text[]` arrays and `jsonb` are parsed natively.
interface ExportBaseRow {
  [column: string]: unknown
  export_id: string
  key: string
  schema_version: number
  recipe_id: number
  item_id: number
  day: number
  first_client_observed_at: string
  last_client_observed_at: string
  observed_second_ship_id: number
  observed_flagship_ids: number[]
  sources: string[]
  first_reported: string
  last_reported: string
  count: string
}

interface CostExportRow extends ExportBaseRow {
  item_level: number
  stage: number
  fuel: number
  ammo: number
  steel: number
  bauxite: number
  buildkit: number
  remodelkit: number
  certain_buildkit: number
  certain_remodelkit: number
  req_slot_items: RequiredItem[]
  req_use_items: RequiredItem[]
  change_flag: number
}

interface UpdateExportRow extends ExportBaseRow {
  item_level: number
  upgrade_to_item_id: number
  upgrade_to_item_level: number
  upgrade_observed: boolean
}

const toPublicBaseRecord = (row: ExportBaseRow) => ({
  _id: row.export_id,
  key: row.key,
  schemaVersion: row.schema_version,
  recipeId: row.recipe_id,
  itemId: row.item_id,
  day: row.day,
  firstClientObservedAt: Number(row.first_client_observed_at),
  lastClientObservedAt: Number(row.last_client_observed_at),
  observedSecondShipId: row.observed_second_ship_id,
  observedFlagshipIds: row.observed_flagship_ids,
  sources: row.sources,
  firstReported: Number(row.first_reported),
  lastReported: Number(row.last_reported),
  count: Number(row.count),
})

const toPublicAvailabilityRecord = (row: ExportBaseRow) => toPublicBaseRecord(row)

const toPublicCostRecord = (row: CostExportRow) => ({
  ...toPublicBaseRecord(row),
  itemLevel: row.item_level,
  stage: row.stage,
  fuel: row.fuel,
  ammo: row.ammo,
  steel: row.steel,
  bauxite: row.bauxite,
  buildkit: row.buildkit,
  remodelkit: row.remodelkit,
  certainBuildkit: row.certain_buildkit,
  certainRemodelkit: row.certain_remodelkit,
  reqSlotItems: row.req_slot_items,
  reqUseItems: row.req_use_items,
  changeFlag: row.change_flag,
})

const toPublicUpdateRecord = (row: UpdateExportRow) => ({
  ...toPublicBaseRecord(row),
  itemLevel: row.item_level,
  upgradeToItemId: row.upgrade_to_item_id,
  upgradeToItemLevel: row.upgrade_to_item_level,
  upgradeObserved: row.upgrade_observed,
})

const assertDefinitionIdentity = (
  rows: Array<{ title: string; detail: string }>,
  expected: { title: string; detail: string },
  kind: 'quest' | 'quest reward',
): void => {
  const row = rows[0]
  if (row == null || row.title !== expected.title || row.detail !== expected.detail) {
    throw new Error(`${kind} identity hash collision: retained title/detail do not match`)
  }
}

export const createPostgresV3Actions = (db: PostgresDb): ReportV3Actions => {
  const saveAvailabilityFact = async (record: ItemImprovementRecipeListRecord): Promise<void> => {
    const key = createAvailabilityKey(record)
    const origins = record.origin != null ? [record.origin] : []
    await db
      .insert(itemImprovementAvailabilityFacts)
      .values({
        key,
        schemaVersion: record.schemaVersion,
        recipeId: record.recipeId,
        itemId: record.itemId,
        day: record.day,
        firstClientObservedAt: record.clientObservedAt,
        lastClientObservedAt: record.clientObservedAt,
        observedSecondShipId: record.observedSecondShipId,
        observedFlagshipIds: record.observedFlagshipIds,
        sources: [record.source],
        origins,
        firstReported: dbTimeMillis,
        lastReported: dbTimeMillis,
      })
      .onConflictDoUpdate({
        target: itemImprovementAvailabilityFacts.key,
        set: {
          firstClientObservedAt: sql`least(${itemImprovementAvailabilityFacts.firstClientObservedAt}, ${record.clientObservedAt})`,
          lastClientObservedAt: sql`greatest(${itemImprovementAvailabilityFacts.lastClientObservedAt}, ${record.clientObservedAt})`,
          lastReported: sql`greatest(${itemImprovementAvailabilityFacts.lastReported}, ${dbTimeMillis})`,
          sources: appendDistinctInOrder(
            itemImprovementAvailabilityFacts.sources,
            [record.source],
            'text',
          ),
          origins: appendDistinctInOrder(itemImprovementAvailabilityFacts.origins, origins, 'text'),
          observedFlagshipIds: appendDistinctInOrder(
            itemImprovementAvailabilityFacts.observedFlagshipIds,
            record.observedFlagshipIds,
            'integer',
          ),
          count: sql`${itemImprovementAvailabilityFacts.count} + 1`,
        },
      })
  }

  const saveCostFact = async (record: ItemImprovementRecipeDetailRecord): Promise<void> => {
    const key = createCostKey(record)
    const origins = record.origin != null ? [record.origin] : []
    await db
      .insert(itemImprovementCostFacts)
      .values({
        key,
        schemaVersion: record.schemaVersion,
        recipeId: record.recipeId,
        itemId: record.itemId,
        day: record.day,
        firstClientObservedAt: record.clientObservedAt,
        lastClientObservedAt: record.clientObservedAt,
        observedSecondShipId: record.observedSecondShipId,
        observedFlagshipIds: record.observedFlagshipIds,
        sources: [record.source],
        origins,
        firstReported: dbTimeMillis,
        lastReported: dbTimeMillis,
        itemLevel: record.itemLevel,
        stage: record.stage,
        fuel: record.fuel,
        ammo: record.ammo,
        steel: record.steel,
        bauxite: record.bauxite,
        buildkit: record.buildkit,
        remodelkit: record.remodelkit,
        certainBuildkit: record.certainBuildkit,
        certainRemodelkit: record.certainRemodelkit,
        reqSlotItems: record.reqSlotItems,
        reqUseItems: record.reqUseItems,
        changeFlag: record.changeFlag,
      })
      .onConflictDoUpdate({
        target: itemImprovementCostFacts.key,
        set: {
          firstClientObservedAt: sql`least(${itemImprovementCostFacts.firstClientObservedAt}, ${record.clientObservedAt})`,
          lastClientObservedAt: sql`greatest(${itemImprovementCostFacts.lastClientObservedAt}, ${record.clientObservedAt})`,
          lastReported: sql`greatest(${itemImprovementCostFacts.lastReported}, ${dbTimeMillis})`,
          sources: appendDistinctInOrder(itemImprovementCostFacts.sources, [record.source], 'text'),
          origins: appendDistinctInOrder(itemImprovementCostFacts.origins, origins, 'text'),
          observedFlagshipIds: appendDistinctInOrder(
            itemImprovementCostFacts.observedFlagshipIds,
            record.observedFlagshipIds,
            'integer',
          ),
          count: sql`${itemImprovementCostFacts.count} + 1`,
        },
      })
  }

  const saveUpdateFact = async (record: ItemImprovementRecipeExecutionRecord): Promise<void> => {
    const key = createUpdateKey(record)
    const origins = record.origin != null ? [record.origin] : []
    await db
      .insert(itemImprovementUpdateFacts)
      .values({
        key,
        schemaVersion: record.schemaVersion,
        recipeId: record.recipeId,
        itemId: record.itemId,
        day: record.day,
        firstClientObservedAt: record.clientObservedAt,
        lastClientObservedAt: record.clientObservedAt,
        observedSecondShipId: record.observedSecondShipId,
        observedFlagshipIds: record.observedFlagshipIds,
        sources: [record.source],
        origins,
        firstReported: dbTimeMillis,
        lastReported: dbTimeMillis,
        itemLevel: record.itemLevel,
        upgradeToItemId: record.upgradeToItemId,
        upgradeToItemLevel: record.upgradeToItemLevel,
        upgradeObserved: true,
      })
      .onConflictDoUpdate({
        target: itemImprovementUpdateFacts.key,
        set: {
          firstClientObservedAt: sql`least(${itemImprovementUpdateFacts.firstClientObservedAt}, ${record.clientObservedAt})`,
          lastClientObservedAt: sql`greatest(${itemImprovementUpdateFacts.lastClientObservedAt}, ${record.clientObservedAt})`,
          lastReported: sql`greatest(${itemImprovementUpdateFacts.lastReported}, ${dbTimeMillis})`,
          sources: appendDistinctInOrder(
            itemImprovementUpdateFacts.sources,
            [record.source],
            'text',
          ),
          origins: appendDistinctInOrder(itemImprovementUpdateFacts.origins, origins, 'text'),
          observedFlagshipIds: appendDistinctInOrder(
            itemImprovementUpdateFacts.observedFlagshipIds,
            record.observedFlagshipIds,
            'integer',
          ),
          count: sql`${itemImprovementUpdateFacts.count} + 1`,
        },
      })
  }

  // Each branch is exactly one `insert().onConflictDoUpdate()` call, i.e. one PostgreSQL statement
  // and one implicit transaction per Fact write, satisfying the plan's "Keep each Fact write to
  // one database statement and one transaction."
  const saveItemImprovementRecipeRecord = (record: ItemImprovementRecipeRecord): Promise<void> => {
    if (record.source === 'list') {
      return saveAvailabilityFact(record)
    }
    if (record.source === 'detail') {
      return saveCostFact(record)
    }
    return saveUpdateFact(record)
  }

  const itemImprovementRecipe = async (request: AppRequest): Promise<AppResult> => {
    try {
      const serverReceivedAt = Date.now()
      const origin = getReporterOrigin(request)
      const recordSchema = createItemImprovementRecipeRecordSchema(serverReceivedAt)
      const records = parseItemImprovementRecipeData(getRequestData(request.body)).map((record) =>
        normalizeItemImprovementRecipeRecord(record, recordSchema, origin),
      )

      await bluebird.map(records, (record) => saveItemImprovementRecipeRecord(record), {
        concurrency: ITEM_IMPROVEMENT_RECIPE_INGEST_CONCURRENCY,
      })

      return ok({ records: records.length })
    } catch (err) {
      if (isItemImprovementValidationError(err)) {
        logReportValidationIssues(
          request,
          err instanceof ZodError ? err.issues : [{ message: err.message }],
          getRequestData(request.body),
        )
        return badRequest(getItemImprovementRecipeValidationErrorMessage(err))
      }

      captureException(err, request)
      return internalServerError()
    }
  }

  // Shared response shaping: the plan's `next` cursor is derived only from settled rows, which is
  // already guaranteed because `buildQuery` never selects rows outside the 30-second settled
  // window (see buildExportPredicate). Error handling is likewise shared across all three exports;
  // only the row shape (and therefore the query and mapper) differs per Fact kind.
  const withExportErrorHandling = async (
    request: AppRequest,
    run: () => Promise<AppResult>,
  ): Promise<AppResult> => {
    try {
      return await run()
    } catch (err) {
      if (isItemImprovementValidationError(err)) {
        logReportValidationIssues(
          request,
          err instanceof ZodError ? err.issues : [{ message: err.message }],
          request.query,
        )
        return badRequest(getItemImprovementRecipeValidationErrorMessage(err))
      }

      captureException(err, request)
      return internalServerError()
    }
  }

  const buildExportResponse = (
    request: AppRequest,
    records: Record<string, unknown>[],
    lastRow: ExportBaseRow | undefined,
  ): AppResult =>
    withCloudflareCache(
      request,
      ok({
        records,
        next:
          lastRow == null
            ? null
            : {
                updatedAfter: Number(lastRow.last_reported),
                afterId: lastRow.export_id,
              },
      }),
    )

  const itemImprovementRecipeAvailability = (request: AppRequest) =>
    withExportErrorHandling(request, async () => {
      const cursor = parseExportCursor(request)
      const { rows } = await db.execute<ExportBaseRow>(buildAvailabilityExportQuery(cursor))
      return buildExportResponse(
        request,
        rows.map(toPublicAvailabilityRecord),
        rows[rows.length - 1],
      )
    })

  const itemImprovementRecipeCosts = (request: AppRequest) =>
    withExportErrorHandling(request, async () => {
      const cursor = parseExportCursor(request)
      const { rows } = await db.execute<CostExportRow>(buildCostExportQuery(cursor))
      return buildExportResponse(request, rows.map(toPublicCostRecord), rows[rows.length - 1])
    })

  const itemImprovementRecipeUpdates = (request: AppRequest) =>
    withExportErrorHandling(request, async () => {
      const cursor = parseExportCursor(request)
      const { rows } = await db.execute<UpdateExportRow>(buildUpdateExportQuery(cursor))
      return buildExportResponse(request, rows.map(toPublicUpdateRecord), rows[rows.length - 1])
    })

  // Mirrors MongoDB's `Quest.distinct('key').exec()` followed by an unsorted `.slice(0, 8)` map:
  // PostgreSQL's `selectDistinct` is likewise not ordered, and 32-character keys are truncated
  // without re-deduplicating the resulting 8-character prefixes, matching current behavior exactly.
  const knownQuests = async (request: AppRequest): Promise<AppResult> => {
    try {
      const rows = await db.selectDistinct({ key: quests.key }).from(quests)
      return withCloudflareCache(request, ok({ quests: rows.map((row) => row.key.slice(0, 8)) }))
    } catch (err) {
      captureException(err, request)
      return internalServerError()
    }
  }

  // Definition Domain Identity is `(key, questId, category)`; a conflict means this exact quest
  // definition was already recorded, so PostgreSQL's `onConflictDoNothing` matches Mongo's
  // `$setOnInsert`-only upsert (nothing is ever mutated on an existing row).
  const quest = async (request: AppRequest): Promise<AppResult> => {
    try {
      const info = normalizeQuestReport(parseReportInfo(request), request)

      await bluebird.map(info.quests, (questItem) => {
        const key = createQuestHash(questItem)
        return db
          .insert(quests)
          .values({
            key,
            questId: questItem.questId,
            title: questItem.title,
            detail: questItem.detail,
            category: questItem.category,
            type: questItem.type,
            origin: info.origin,
          })
          .onConflictDoUpdate({
            target: [quests.key, quests.questId, quests.category],
            set: {
              title: sql`${quests.title}`,
              detail: sql`${quests.detail}`,
            },
            setWhere: and(eq(quests.title, questItem.title), eq(quests.detail, questItem.detail)),
          })
          .returning({ title: quests.title, detail: quests.detail })
          .then((rows) => assertDefinitionIdentity(rows, questItem, 'quest'))
      })

      return ok()
    } catch (err) {
      return handleReportError(err, request)
    }
  }

  // Reward Domain Identity is `(key, questId, selections, bonusCount)`. The legacy plugin field
  // `bounsCount` is accepted on ingest but stored in the `bonus_count` schema column exactly like
  // MongoDB's `QuestReward` model (see docs/postgresql-migration-plan.md's v3 quests row).
  const questReward = async (request: AppRequest): Promise<AppResult> => {
    try {
      const info = normalizeQuestRewardReport(parseReportInfo(request), request)
      const key = createQuestHash(info)

      const rows = await db
        .insert(questRewards)
        .values({
          key,
          questId: info.questId,
          title: info.title,
          detail: info.detail,
          category: info.category,
          type: info.type,
          origin: info.origin,
          selections: info.selections,
          material: info.material,
          bonus: info.bonus,
          bonusCount: info.bounsCount,
        })
        .onConflictDoUpdate({
          target: [
            questRewards.key,
            questRewards.questId,
            questRewards.selections,
            questRewards.bonusCount,
          ],
          set: {
            title: sql`${questRewards.title}`,
            detail: sql`${questRewards.detail}`,
          },
          setWhere: and(eq(questRewards.title, info.title), eq(questRewards.detail, info.detail)),
        })
        .returning({ title: questRewards.title, detail: questRewards.detail })
      assertDefinitionIdentity(rows, info, 'quest reward')

      return ok()
    } catch (err) {
      return handleReportError(err, request)
    }
  }

  return {
    itemImprovementRecipe,
    itemImprovementRecipeAvailability,
    itemImprovementRecipeCosts,
    itemImprovementRecipeUpdates,
    knownQuests,
    quest,
    questReward,
  }
}
