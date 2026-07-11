import { createHash } from 'crypto'

import { and, eq, sql, type SQL } from 'drizzle-orm'
import { type NodePgDatabase } from 'drizzle-orm/node-postgres'

import {
  aaciReportSchema,
  battleApiReportSchema,
  createItemReportSchema,
  createShipReportSchema,
  dropShipReportSchema,
  enemyInfoReportSchema,
  nightBattleCiReportSchema,
  nightContactReportSchema,
  passEventReportSchema,
  recipeReportSchema,
  remodelItemReportSchema,
  selectRankReportSchema,
  shipStatReportSchema,
} from '../../../contracts/v2-report'
import * as schema from '../../../db/postgres/schema'
import { withCloudflareCache } from '../../../http/cache-control'
import { type AppRequest } from '../../../http/request'
import { internalServerError, ok, type AppResult } from '../../../http/result'
import { captureException } from '../../../sentry'
import { type ReportV2Actions } from './v2.fastify'
import { handleReportError, parseReportInfo, resolveAaciPersistence } from './shared'

const {
  aaciRecords,
  battleApis,
  createItemRecords,
  createShipRecords,
  dropShipRecords,
  enemyInfos,
  nightBattleCis,
  nightContacts,
  passEventRecords,
  quests,
  recipeRecords,
  remodelItemRecords,
  selectRankRecords,
  shipStats,
} = schema

type PostgresDb = NodePgDatabase<typeof schema>

// Database-generated millisecond epoch, used everywhere the plan requires "database time" (rather
// than an application-captured `Date.now()`) for accumulation columns such as `last_reported` and
// `last_timestamp`. Kept as a JS-safe integer per the plan's bigint-number-mode contract.
const dbTimeMillis: SQL<number> = sql<number>`(extract(epoch from clock_timestamp()) * 1000)::bigint`

// Includes only the listed keys that are actually present (own property) on `info`, preserving
// explicit `null` values while omitting keys the shared validator left absent. Used to build
// partial `ON CONFLICT DO UPDATE SET` patches where a missing field must not erase a stored value.
export const pickPresentFields = (
  info: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> => {
  const patch: Record<string, unknown> = {}
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(info, field)) {
      patch[field] = info[field]
    }
  }
  return patch
}

export interface EnemyInfoIdentityComponents {
  equips1: unknown
  equips2: unknown
  hp1: unknown
  hp2: unknown
  levels1: unknown
  levels2: unknown
  planes: unknown
  ships1: unknown
  ships2: unknown
  stats1: unknown
  stats2: unknown
}

// Canonical ordered tuple identity hash, matching docs/postgresql-migration-plan.md's Enemy Info
// upsert key exactly (order matters; do not sort fleet values).
export const computeEnemyInfoIdentityHash = (components: EnemyInfoIdentityComponents): Buffer =>
  createHash('sha256')
    .update(
      JSON.stringify([
        components.ships1,
        components.levels1,
        components.hp1,
        components.stats1,
        components.equips1,
        components.ships2,
        components.levels2,
        components.hp2,
        components.stats2,
        components.equips2,
        components.planes,
      ]),
    )
    .digest()

const RECIPE_NON_IDENTITY_FIELDS = [
  'fuel',
  'ammo',
  'steel',
  'bauxite',
  'reqItemId',
  'reqItemCount',
  'buildkit',
  'remodelkit',
  'certainBuildkit',
  'certainRemodelkit',
  'upgradeToItemId',
  'upgradeToItemLevel',
  'key',
  'origin',
] as const

const ENEMY_INFO_IDENTITY_COLUMNS = [
  'ships1',
  'levels1',
  'hp1',
  'stats1',
  'equips1',
  'ships2',
  'levels2',
  'hp2',
  'stats2',
  'equips2',
  'planes',
] as const

// Presence-aware `bombersMin` update patch (Mongo `$max` equivalent). An absent key and an explicit
// null are behaviorally identical: both leave the stored bound unchanged, so both are omitted from
// the `ON CONFLICT DO UPDATE SET` patch. Only a numeric value contributes a `greatest` expression.
const resolveBombersMinPatch = (info: Record<string, unknown>): Record<string, SQL> => {
  const value = info.bombersMin
  if (typeof value !== 'number') {
    return {}
  }
  return { bombersMin: sql`greatest(${schema.enemyInfos.bombersMin}, ${value})` }
}

// Presence-aware `bombersMax` update patch (Mongo `$min` equivalent). An absent key leaves the
// stored bound unchanged (omitted); an explicit null actively replaces the stored maximum with
// null; a numeric value contributes a `least` expression.
const resolveBombersMaxPatch = (info: Record<string, unknown>): Record<string, SQL | null> => {
  if (!Object.prototype.hasOwnProperty.call(info, 'bombersMax')) {
    return {}
  }
  const value = info.bombersMax
  if (value === null) {
    return { bombersMax: null }
  }
  if (typeof value !== 'number') {
    return {}
  }
  return { bombersMax: sql`least(${schema.enemyInfos.bombersMax}, ${value})` }
}

const identityComponentsMatch = (
  row: Record<string, unknown>,
  info: Record<string, unknown>,
): boolean =>
  ENEMY_INFO_IDENTITY_COLUMNS.every(
    (column) => JSON.stringify(row[column]) === JSON.stringify(info[column]),
  )

const toEnemyInfoIdentityComponents = (
  info: Record<string, unknown>,
): EnemyInfoIdentityComponents => ({
  ships1: info.ships1,
  levels1: info.levels1,
  hp1: info.hp1,
  stats1: info.stats1,
  equips1: info.equips1,
  ships2: info.ships2,
  levels2: info.levels2,
  hp2: info.hp2,
  stats2: info.stats2,
  equips2: info.equips2,
  planes: info.planes,
})

export const createPostgresV2Actions = (db: PostgresDb): ReportV2Actions => {
  const withReportErrorHandling = async (
    request: AppRequest,
    run: () => Promise<AppResult>,
  ): Promise<AppResult> => {
    try {
      return await run()
    } catch (err) {
      return handleReportError(err, request)
    }
  }

  const createShip = (request: AppRequest) =>
    withReportErrorHandling(request, async () => {
      const info = parseReportInfo(request, createShipReportSchema)
      await db.insert(createShipRecords).values({
        items: info.items,
        kdockId: info.kdockId,
        secretary: info.secretary,
        shipId: info.shipId,
        highspeed: info.highspeed,
        teitokuLv: info.teitokuLv,
        largeFlag: info.largeFlag,
        origin: info.origin,
      })
      return ok()
    })

  const createItem = (request: AppRequest) =>
    withReportErrorHandling(request, async () => {
      const info = parseReportInfo(request, createItemReportSchema)
      await db.insert(createItemRecords).values({
        items: info.items,
        secretary: info.secretary,
        itemId: info.itemId,
        teitokuLv: info.teitokuLv,
        successful: info.successful,
        origin: info.origin,
      })
      return ok()
    })

  const remodelItem = (request: AppRequest) =>
    withReportErrorHandling(request, async () => {
      const info = parseReportInfo(request, remodelItemReportSchema)
      await db.insert(remodelItemRecords).values({
        successful: info.successful,
        itemId: info.itemId,
        itemLevel: info.itemLevel,
        flagshipId: info.flagshipId,
        flagshipLevel: info.flagshipLevel,
        flagshipCond: info.flagshipCond,
        consortId: info.consortId,
        consortLevel: info.consortLevel,
        consortCond: info.consortCond,
        teitokuLv: info.teitokuLv,
        certain: info.certain,
      })
      return ok()
    })

  const dropShip = (request: AppRequest) =>
    withReportErrorHandling(request, async () => {
      const info = parseReportInfo(request, dropShipReportSchema)
      // `Number(undefined)` is `NaN` (absent mapId is not late); `Number(null)` is `0` (explicit
      // null mapId is late), exactly matching the legacy Mongoose `record.mapId < 73` coercion.
      const isLateMap = Number(info.mapId) < 73
      await db.insert(dropShipRecords).values({
        shipId: info.shipId,
        itemId: info.itemId,
        mapId: info.mapId,
        quest: info.quest,
        cellId: info.cellId,
        enemy: info.enemy,
        rank: info.rank,
        isBoss: info.isBoss,
        teitokuLv: info.teitokuLv,
        mapLv: info.mapLv,
        enemyShips1: info.enemyShips1,
        enemyShips2: info.enemyShips2,
        enemyFormation: info.enemyFormation,
        baseExp: info.baseExp,
        teitokuId: info.teitokuId,
        ownedShipSnapshot: isLateMap ? {} : info.ownedShipSnapshot,
        origin: info.origin,
      })
      return ok()
    })

  const selectRank = (request: AppRequest) =>
    withReportErrorHandling(request, async () => {
      const info = parseReportInfo(request, selectRankReportSchema)
      await db
        .insert(selectRankRecords)
        .values({
          teitokuId: info.teitokuId,
          mapareaId: info.mapareaId,
          teitokuLv: info.teitokuLv,
          rank: info.rank,
          origin: info.origin,
        })
        .onConflictDoUpdate({
          target: [selectRankRecords.teitokuId, selectRankRecords.mapareaId],
          set: {
            teitokuLv: info.teitokuLv,
            rank: info.rank,
            origin: info.origin,
          },
        })
      return ok()
    })

  const passEvent = (request: AppRequest) =>
    withReportErrorHandling(request, async () => {
      const info = parseReportInfo(request, passEventReportSchema)
      await db.insert(passEventRecords).values({
        teitokuId: info.teitokuId,
        teitokuLv: info.teitokuLv,
        mapId: info.mapId,
        mapLv: info.mapLv,
        rewards: info.rewards,
        origin: info.origin,
      })
      return ok()
    })

  const knownQuests = async (request: AppRequest): Promise<AppResult> => {
    try {
      const rows = await db.selectDistinct({ questId: quests.questId }).from(quests)
      const knownQuestIds = rows.map((row) => row.questId)
      knownQuestIds.sort()
      return withCloudflareCache(request, ok({ quests: knownQuestIds }))
    } catch (err) {
      captureException(err, request)
      return internalServerError()
    }
  }

  const questNoop = async (): Promise<AppResult> => ok()

  const battleApi = (request: AppRequest) =>
    withReportErrorHandling(request, async () => {
      const info = parseReportInfo(request, battleApiReportSchema)
      await db.insert(battleApis).values({
        origin: info.origin,
        path: info.path,
        data: info.data,
      })
      return ok()
    })

  const nightContact = (request: AppRequest) =>
    withReportErrorHandling(request, async () => {
      const info = parseReportInfo(request, nightContactReportSchema)
      await db.insert(nightContacts).values({
        fleetType: info.fleetType,
        shipId: info.shipId,
        shipLv: info.shipLv,
        itemId: info.itemId,
        itemLv: info.itemLv,
        contact: info.contact,
      })
      return ok()
    })

  const aaci = (request: AppRequest) =>
    withReportErrorHandling(request, async () => {
      const info = parseReportInfo(request, aaciReportSchema)
      if (resolveAaciPersistence(request, info.poiVersion, info.origin)) {
        await db.insert(aaciRecords).values({
          poiVersion: info.poiVersion,
          available: info.available,
          triggered: info.triggered,
          items: info.items,
          improvement: info.improvement,
          rawLuck: info.rawLuck,
          rawTaiku: info.rawTaiku,
          lv: info.lv,
          hpPercent: info.hpPercent,
          pos: info.pos,
          origin: info.origin,
        })
      }
      return ok()
    })

  const knownRecipes = async (): Promise<AppResult> => ok({ recipes: [] })

  const remodelRecipe = (request: AppRequest) =>
    withReportErrorHandling(request, async () => {
      const info = parseReportInfo(request, recipeReportSchema)
      if (info.stage === -1) {
        return ok()
      }

      const nonIdentityPatch = pickPresentFields(info, RECIPE_NON_IDENTITY_FIELDS)
      await db
        .insert(recipeRecords)
        .values({
          recipeId: info.recipeId,
          itemId: info.itemId,
          stage: info.stage,
          day: info.day,
          secretary: info.secretary,
          lastReported: dbTimeMillis,
          ...nonIdentityPatch,
        })
        .onConflictDoUpdate({
          target: [
            recipeRecords.recipeId,
            recipeRecords.itemId,
            recipeRecords.stage,
            recipeRecords.day,
            recipeRecords.secretary,
          ],
          set: {
            count: sql`${recipeRecords.count} + 1`,
            lastReported: dbTimeMillis,
            ...nonIdentityPatch,
          },
        })
      return ok()
    })

  // PostgreSQL enforces the recipe Domain Identity with a unique constraint, so duplicates cannot
  // accumulate the way legacy MongoDB records did; there is nothing to deduplicate.
  const remodelRecipeDeduplicate = async (): Promise<AppResult> => ok({ recipes: [] })

  const nightBattleCi = (request: AppRequest) =>
    withReportErrorHandling(request, async () => {
      const info = parseReportInfo(request, nightBattleCiReportSchema)
      await db.insert(nightBattleCis).values({
        shipId: info.shipId,
        ci: info.CI,
        type: info.type,
        lv: info.lv,
        rawLuck: info.rawLuck,
        pos: info.pos,
        status: info.status,
        items: info.items,
        improvement: info.improvement,
        searchLight: info.searchLight,
        flare: info.flare,
        defenseId: info.defenseId,
        defenseTypeId: info.defenseTypeId,
        ciType: info.ciType,
        display: info.display,
        hitType: info.hitType,
        damage: info.damage,
        damageTotal: info.damageTotal,
        time: info.time,
        origin: info.origin,
      })
      return ok()
    })

  const nightBattleSsCi = async (): Promise<AppResult> => ok()

  const shipStat = (request: AppRequest) =>
    withReportErrorHandling(request, async () => {
      const info = parseReportInfo(request, shipStatReportSchema)
      await db
        .insert(shipStats)
        .values({
          shipId: info.id,
          lv: info.lv,
          los: info.los,
          losMax: info.los_max,
          asw: info.asw,
          aswMax: info.asw_max,
          evasion: info.evasion,
          evasionMax: info.evasion_max,
          lastTimestamp: dbTimeMillis,
        })
        .onConflictDoUpdate({
          target: [
            shipStats.shipId,
            shipStats.lv,
            shipStats.los,
            shipStats.losMax,
            shipStats.asw,
            shipStats.aswMax,
            shipStats.evasion,
            shipStats.evasionMax,
          ],
          set: {
            count: sql`${shipStats.count} + 1`,
            lastTimestamp: dbTimeMillis,
          },
        })
      return ok()
    })

  const enemyInfo = (request: AppRequest) =>
    withReportErrorHandling(request, async () => {
      const info = parseReportInfo(request, enemyInfoReportSchema)
      const identityHash = computeEnemyInfoIdentityHash(toEnemyInfoIdentityComponents(info))

      const rows = await db
        .insert(enemyInfos)
        .values({
          identityHash,
          ships1: info.ships1,
          levels1: info.levels1,
          hp1: info.hp1,
          stats1: info.stats1,
          equips1: info.equips1,
          ships2: info.ships2,
          levels2: info.levels2,
          hp2: info.hp2,
          stats2: info.stats2,
          equips2: info.equips2,
          planes: info.planes,
          bombersMin: info.bombersMin ?? null,
          bombersMax: info.bombersMax ?? null,
        })
        .onConflictDoUpdate({
          target: enemyInfos.identityHash,
          setWhere: and(
            eq(enemyInfos.ships1, info.ships1),
            eq(enemyInfos.levels1, info.levels1),
            eq(enemyInfos.hp1, info.hp1),
            eq(enemyInfos.stats1, info.stats1),
            eq(enemyInfos.equips1, info.equips1),
            eq(enemyInfos.ships2, info.ships2),
            eq(enemyInfos.levels2, info.levels2),
            eq(enemyInfos.hp2, info.hp2),
            eq(enemyInfos.stats2, info.stats2),
            eq(enemyInfos.equips2, info.equips2),
            eq(enemyInfos.planes, info.planes),
          ),
          set: {
            count: sql`${enemyInfos.count} + 1`,
            ...resolveBombersMinPatch(info),
            ...resolveBombersMaxPatch(info),
          },
        })
        .returning({
          ships1: enemyInfos.ships1,
          levels1: enemyInfos.levels1,
          hp1: enemyInfos.hp1,
          stats1: enemyInfos.stats1,
          equips1: enemyInfos.equips1,
          ships2: enemyInfos.ships2,
          levels2: enemyInfos.levels2,
          hp2: enemyInfos.hp2,
          stats2: enemyInfos.stats2,
          equips2: enemyInfos.equips2,
          planes: enemyInfos.planes,
        })

      const [row] = rows
      if (row == null || !identityComponentsMatch(row, info)) {
        captureException(
          new Error('enemy_info identity hash collision: retained components do not match'),
          request,
        )
        return internalServerError()
      }
      return ok()
    })

  return {
    aaci,
    battleApi,
    createItem,
    createShip,
    dropShip,
    enemyInfo,
    knownQuests,
    knownRecipes,
    nightBattleCi,
    nightBattleSsCi,
    nightContact,
    passEvent,
    questNoop,
    remodelItem,
    remodelRecipe,
    remodelRecipeDeduplicate,
    selectRank,
    shipStat,
  }
}
