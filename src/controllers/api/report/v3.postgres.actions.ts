import crypto from 'crypto'

import bluebird from 'bluebird'
import { and, asc, eq, gt, lte, or, sql } from 'drizzle-orm'

import { config } from '../../../config'
import { getPostgresDb } from '../../../db/postgres'
import {
  itemImprovementAvailabilityFacts,
  itemImprovementCostFacts,
  itemImprovementUpdateFacts,
  questRewards,
  quests,
} from '../../../db/schema/postgres'
import { type AppRequest } from '../../../http/request'
import { type QuestPayload, type QuestRewardPayload } from '../../../models'
import {
  ITEM_IMPROVEMENT_RECIPE_INGEST_CONCURRENCY,
  ItemImprovementRecipeValidationError,
  type ItemImprovementRecipeExportResult,
  type ItemImprovementRecipeRecord,
  createAvailabilityKey,
  createCostKey,
  createItemImprovementRecipeRecordSchema,
  createUpdateKey,
  getItemImprovementRecipeValidationErrorMessage,
  getReporterOrigin,
  isItemImprovementValidationError,
  normalizeItemImprovementRecipeRecordWithRawPayload,
  parseExportCursor,
  parseItemImprovementRecipeData,
} from './v3.item-improvement.shared'

const ITEM_IMPROVEMENT_EXPORT_SETTLE_WINDOW_MS = 2_000

const getDb = () => getPostgresDb(config.db)

const createQuestHash = ({ title, detail }: QuestPayload | QuestRewardPayload) =>
  crypto.createHash('md5').update(`${title}${detail}`).digest('hex')

const jsonbMerge = <TRawColumn extends { name: string }>(rawColumn: TRawColumn) =>
  sql`coalesce(${rawColumn}, '{}'::jsonb) || coalesce(${sql.raw(`excluded.${rawColumn.name}`)}, '{}'::jsonb)`

const arrayUnionPreservingOrder = <TArrayColumn extends { name: string }>(
  column: TArrayColumn,
  pgArrayType: 'integer[]' | 'text[]',
) => sql`
  array(
    select value
    from (
      select value, min(ord) as first_ord
      from unnest(
        coalesce(${column}, array[]::${sql.raw(pgArrayType)}) ||
        coalesce(${sql.raw(`excluded.${column.name}`)}, array[]::${sql.raw(pgArrayType)})
      ) with ordinality as merged(value, ord)
      group by value
    ) dedup
    order by first_ord
  )
`

const createBaseFactValues = (
  record: ItemImprovementRecipeRecord,
  lastReported: number,
  rawPayload: Record<string, unknown>,
) => ({
  schemaVersion: record.schemaVersion,
  recipeId: record.recipeId,
  itemId: record.itemId,
  day: record.day,
  firstClientObservedAt: record.clientObservedAt,
  lastClientObservedAt: record.clientObservedAt,
  observedSecondShipId: record.observedSecondShipId,
  observedFlagshipIds: record.observedFlagshipIds,
  sources: [record.source],
  origins: record.origin == null ? [] : [record.origin],
  firstReported: lastReported,
  lastReported,
  count: 1,
  rawPayload,
})

const createCommonFactConflictSet = <
  TTable extends {
    firstClientObservedAt: { name: string }
    lastClientObservedAt: { name: string }
    lastReported: { name: string }
    observedFlagshipIds: { name: string }
    sources: { name: string }
    origins: { name: string }
    count: { name: string }
    rawPayload: { name: string }
  },
>(
  table: TTable,
) => ({
  firstClientObservedAt: sql`least(${table.firstClientObservedAt}, excluded.first_client_observed_at)`,
  lastClientObservedAt: sql`greatest(${table.lastClientObservedAt}, excluded.last_client_observed_at)`,
  lastReported: sql`greatest(${table.lastReported}, excluded.last_reported)`,
  observedFlagshipIds: arrayUnionPreservingOrder(table.observedFlagshipIds, 'integer[]'),
  sources: arrayUnionPreservingOrder(table.sources, 'text[]'),
  origins: arrayUnionPreservingOrder(table.origins, 'text[]'),
  count: sql`${table.count} + 1`,
  rawPayload: jsonbMerge(table.rawPayload),
})

const saveItemImprovementRecipeRecord = async (
  record: ItemImprovementRecipeRecord,
  rawPayload: Record<string, unknown>,
  lastReported: number,
): Promise<void> => {
  if (record.source === 'list') {
    const key = createAvailabilityKey(record)
    await getDb()
      .insert(itemImprovementAvailabilityFacts)
      .values({
        key,
        ...createBaseFactValues(record, lastReported, rawPayload),
      })
      .onConflictDoUpdate({
        target: itemImprovementAvailabilityFacts.key,
        set: createCommonFactConflictSet(itemImprovementAvailabilityFacts),
      })
    return
  }

  if (record.source === 'detail') {
    const key = createCostKey(record)
    await getDb()
      .insert(itemImprovementCostFacts)
      .values({
        key,
        ...createBaseFactValues(record, lastReported, rawPayload),
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
          ...createCommonFactConflictSet(itemImprovementCostFacts),
        },
      })
    return
  }

  const key = createUpdateKey(record)
  await getDb()
    .insert(itemImprovementUpdateFacts)
    .values({
      key,
      ...createBaseFactValues(record, lastReported, rawPayload),
      itemLevel: record.itemLevel,
      upgradeToItemId: record.upgradeToItemId,
      upgradeToItemLevel: record.upgradeToItemLevel,
      upgradeObserved: true,
    })
    .onConflictDoUpdate({
      target: itemImprovementUpdateFacts.key,
      set: {
        ...createCommonFactConflictSet(itemImprovementUpdateFacts),
      },
    })
}

const buildExportPredicate = <
  TTable extends {
    lastReported: Parameters<typeof lte>[0]
    exportId: Parameters<typeof gt>[0]
  },
>(
  table: TTable,
  updatedAfter: number,
  afterId: string | undefined,
  settledCutoff: number,
) =>
  and(
    lte(table.lastReported, settledCutoff),
    afterId == null
      ? gt(table.lastReported, updatedAfter)
      : or(
          gt(table.lastReported, updatedAfter),
          and(eq(table.lastReported, updatedAfter), gt(table.exportId, afterId)),
        ),
  )

const getSettledCutoff = () => Date.now() - ITEM_IMPROVEMENT_EXPORT_SETTLE_WINDOW_MS

const exportAvailabilityFacts = async (
  request: AppRequest,
): Promise<
  ItemImprovementRecipeExportResult<{
    _id: string
    key: string
    schemaVersion: number
    recipeId: number
    itemId: number
    day: number
    firstClientObservedAt: number
    lastClientObservedAt: number
    observedSecondShipId: number
    observedFlagshipIds: number[]
    sources: string[]
    firstReported: number
    lastReported: number
    count: number
  }>
> => {
  const { updatedAfter, afterId, limit } = parseExportCursor(request)
  const settledCutoff = getSettledCutoff()
  const records = await getDb()
    .select({
      _id: sql<string>`coalesce(${itemImprovementAvailabilityFacts.exportId}, '')`,
      key: itemImprovementAvailabilityFacts.key,
      schemaVersion: itemImprovementAvailabilityFacts.schemaVersion,
      recipeId: itemImprovementAvailabilityFacts.recipeId,
      itemId: itemImprovementAvailabilityFacts.itemId,
      day: itemImprovementAvailabilityFacts.day,
      firstClientObservedAt: itemImprovementAvailabilityFacts.firstClientObservedAt,
      lastClientObservedAt: itemImprovementAvailabilityFacts.lastClientObservedAt,
      observedSecondShipId: itemImprovementAvailabilityFacts.observedSecondShipId,
      observedFlagshipIds: itemImprovementAvailabilityFacts.observedFlagshipIds,
      sources: itemImprovementAvailabilityFacts.sources,
      firstReported: itemImprovementAvailabilityFacts.firstReported,
      lastReported: itemImprovementAvailabilityFacts.lastReported,
      count: itemImprovementAvailabilityFacts.count,
    })
    .from(itemImprovementAvailabilityFacts)
    .where(
      buildExportPredicate(itemImprovementAvailabilityFacts, updatedAfter, afterId, settledCutoff),
    )
    .orderBy(
      asc(itemImprovementAvailabilityFacts.lastReported),
      asc(itemImprovementAvailabilityFacts.exportId),
    )
    .limit(limit)

  const lastRecord = records[records.length - 1]
  return {
    records,
    next:
      lastRecord == null
        ? null
        : {
            updatedAfter: lastRecord.lastReported,
            afterId: lastRecord._id,
          },
  }
}

const exportCostFacts = async (
  request: AppRequest,
): Promise<
  ItemImprovementRecipeExportResult<{
    _id: string
    key: string
    schemaVersion: number
    recipeId: number
    itemId: number
    itemLevel: number
    stage: number
    day: number
    firstClientObservedAt: number
    lastClientObservedAt: number
    observedSecondShipId: number
    observedFlagshipIds: number[]
    fuel: number
    ammo: number
    steel: number
    bauxite: number
    buildkit: number
    remodelkit: number
    certainBuildkit: number
    certainRemodelkit: number
    reqSlotItems: Array<{ id: number; count: number }>
    reqUseItems: Array<{ id: number; count: number }>
    changeFlag: number
    sources: string[]
    firstReported: number
    lastReported: number
    count: number
  }>
> => {
  const { updatedAfter, afterId, limit } = parseExportCursor(request)
  const settledCutoff = getSettledCutoff()
  const records = await getDb()
    .select({
      _id: sql<string>`coalesce(${itemImprovementCostFacts.exportId}, '')`,
      key: itemImprovementCostFacts.key,
      schemaVersion: itemImprovementCostFacts.schemaVersion,
      recipeId: itemImprovementCostFacts.recipeId,
      itemId: itemImprovementCostFacts.itemId,
      itemLevel: itemImprovementCostFacts.itemLevel,
      stage: itemImprovementCostFacts.stage,
      day: itemImprovementCostFacts.day,
      firstClientObservedAt: itemImprovementCostFacts.firstClientObservedAt,
      lastClientObservedAt: itemImprovementCostFacts.lastClientObservedAt,
      observedSecondShipId: itemImprovementCostFacts.observedSecondShipId,
      observedFlagshipIds: itemImprovementCostFacts.observedFlagshipIds,
      fuel: itemImprovementCostFacts.fuel,
      ammo: itemImprovementCostFacts.ammo,
      steel: itemImprovementCostFacts.steel,
      bauxite: itemImprovementCostFacts.bauxite,
      buildkit: itemImprovementCostFacts.buildkit,
      remodelkit: itemImprovementCostFacts.remodelkit,
      certainBuildkit: itemImprovementCostFacts.certainBuildkit,
      certainRemodelkit: itemImprovementCostFacts.certainRemodelkit,
      reqSlotItems: itemImprovementCostFacts.reqSlotItems,
      reqUseItems: itemImprovementCostFacts.reqUseItems,
      changeFlag: itemImprovementCostFacts.changeFlag,
      sources: itemImprovementCostFacts.sources,
      firstReported: itemImprovementCostFacts.firstReported,
      lastReported: itemImprovementCostFacts.lastReported,
      count: itemImprovementCostFacts.count,
    })
    .from(itemImprovementCostFacts)
    .where(buildExportPredicate(itemImprovementCostFacts, updatedAfter, afterId, settledCutoff))
    .orderBy(asc(itemImprovementCostFacts.lastReported), asc(itemImprovementCostFacts.exportId))
    .limit(limit)

  const lastRecord = records[records.length - 1]
  return {
    records,
    next:
      lastRecord == null
        ? null
        : {
            updatedAfter: lastRecord.lastReported,
            afterId: lastRecord._id,
          },
  }
}

const exportUpdateFacts = async (
  request: AppRequest,
): Promise<
  ItemImprovementRecipeExportResult<{
    _id: string
    key: string
    schemaVersion: number
    recipeId: number
    itemId: number
    itemLevel: number
    day: number
    firstClientObservedAt: number
    lastClientObservedAt: number
    observedSecondShipId: number
    observedFlagshipIds: number[]
    upgradeToItemId: number
    upgradeToItemLevel: number
    upgradeObserved: boolean
    sources: string[]
    firstReported: number
    lastReported: number
    count: number
  }>
> => {
  const { updatedAfter, afterId, limit } = parseExportCursor(request)
  const settledCutoff = getSettledCutoff()
  const records = await getDb()
    .select({
      _id: sql<string>`coalesce(${itemImprovementUpdateFacts.exportId}, '')`,
      key: itemImprovementUpdateFacts.key,
      schemaVersion: itemImprovementUpdateFacts.schemaVersion,
      recipeId: itemImprovementUpdateFacts.recipeId,
      itemId: itemImprovementUpdateFacts.itemId,
      itemLevel: itemImprovementUpdateFacts.itemLevel,
      day: itemImprovementUpdateFacts.day,
      firstClientObservedAt: itemImprovementUpdateFacts.firstClientObservedAt,
      lastClientObservedAt: itemImprovementUpdateFacts.lastClientObservedAt,
      observedSecondShipId: itemImprovementUpdateFacts.observedSecondShipId,
      observedFlagshipIds: itemImprovementUpdateFacts.observedFlagshipIds,
      upgradeToItemId: itemImprovementUpdateFacts.upgradeToItemId,
      upgradeToItemLevel: itemImprovementUpdateFacts.upgradeToItemLevel,
      upgradeObserved: itemImprovementUpdateFacts.upgradeObserved,
      sources: itemImprovementUpdateFacts.sources,
      firstReported: itemImprovementUpdateFacts.firstReported,
      lastReported: itemImprovementUpdateFacts.lastReported,
      count: itemImprovementUpdateFacts.count,
    })
    .from(itemImprovementUpdateFacts)
    .where(buildExportPredicate(itemImprovementUpdateFacts, updatedAfter, afterId, settledCutoff))
    .orderBy(asc(itemImprovementUpdateFacts.lastReported), asc(itemImprovementUpdateFacts.exportId))
    .limit(limit)

  const lastRecord = records[records.length - 1]
  return {
    records,
    next:
      lastRecord == null
        ? null
        : {
            updatedAfter: lastRecord.lastReported,
            afterId: lastRecord._id,
          },
  }
}

export {
  ItemImprovementRecipeValidationError,
  getItemImprovementRecipeValidationErrorMessage,
  isItemImprovementValidationError,
}

export const itemImprovementRecipe = async (request: AppRequest): Promise<number> => {
  const serverReceivedAt = Date.now()
  const origin = getReporterOrigin(request)
  const schema = createItemImprovementRecipeRecordSchema(serverReceivedAt)
  const records = parseItemImprovementRecipeData(request).map((record) =>
    normalizeItemImprovementRecipeRecordWithRawPayload(record, schema, origin),
  )

  await bluebird.map(
    records,
    ({ record, rawPayload }) =>
      saveItemImprovementRecipeRecord(record, rawPayload, serverReceivedAt),
    {
      concurrency: ITEM_IMPROVEMENT_RECIPE_INGEST_CONCURRENCY,
    },
  )

  return records.length
}

export const itemImprovementRecipeAvailability = (request: AppRequest) =>
  exportAvailabilityFacts(request)

export const itemImprovementRecipeCosts = (request: AppRequest) => exportCostFacts(request)

export const itemImprovementRecipeUpdates = (request: AppRequest) => exportUpdateFacts(request)

export const knownQuests = async (): Promise<string[]> => {
  const records = await getDb()
    .selectDistinct({ key: quests.key })
    .from(quests)
    .orderBy(asc(quests.key))
  return records.map((record) => record.key.slice(0, 8))
}

export const quest = async (info: Record<string, any>): Promise<void> => {
  const records = info.quests.map((questItem: QuestPayload) => ({
    questId: questItem.questId,
    title: questItem.title,
    detail: questItem.detail,
    category: questItem.category,
    type: questItem.type,
    origin: info.origin,
    key: createQuestHash(questItem),
    rawPayload: {
      ...questItem,
      origin: info.origin,
      key: createQuestHash(questItem),
    },
  }))

  if (records.length === 0) {
    return
  }

  await getDb().insert(quests).values(records).onConflictDoNothing()
}

export const questReward = async (info: QuestRewardPayload): Promise<void> => {
  const key = createQuestHash(info)
  const bonusCount = info.bounsCount

  await getDb()
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
      bonusCount,
      rawPayload: { ...info },
    })
    .onConflictDoNothing()
}
