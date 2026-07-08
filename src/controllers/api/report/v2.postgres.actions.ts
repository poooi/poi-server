import crypto from 'crypto'

import { sql } from 'drizzle-orm'
import semver from 'semver'

import { getPostgresDb } from '../../../db/postgres'
import {
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
} from '../../../db/schema/postgres'
import { config } from '../../../config'

const getDb = () => getPostgresDb(config.db)

type ReportInfo = Record<string, any>

const jsonbMerge = <TRawColumn extends { name: string }>(rawColumn: TRawColumn) =>
  sql`coalesce(${rawColumn}, '{}'::jsonb) || coalesce(${sql.raw(`excluded.${rawColumn.name}`)}, '{}'::jsonb)`

const createEnemyInfoHash = (info: ReportInfo) =>
  crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
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
      }),
    )
    .digest('hex')

export const createShip = async (info: ReportInfo): Promise<void> => {
  await getDb().insert(createShipRecords).values({
    items: info.items,
    kdockId: info.kdockId,
    secretary: info.secretary,
    shipId: info.shipId,
    highspeed: info.highspeed,
    teitokuLv: info.teitokuLv,
    largeFlag: info.largeFlag,
    origin: info.origin,
    rawPayload: info,
  })
}

export const createItem = async (info: ReportInfo): Promise<void> => {
  await getDb().insert(createItemRecords).values({
    items: info.items,
    secretary: info.secretary,
    itemId: info.itemId,
    teitokuLv: info.teitokuLv,
    successful: info.successful,
    origin: info.origin,
    rawPayload: info,
  })
}

export const remodelItem = async (info: ReportInfo): Promise<void> => {
  await getDb().insert(remodelItemRecords).values({
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
    rawPayload: info,
  })
}

export const dropShip = async (info: ReportInfo): Promise<void> => {
  const normalizedInfo = info.mapId < 73 ? { ...info, ownedShipSnapshot: {} } : info

  await getDb().insert(dropShipRecords).values({
    shipId: normalizedInfo.shipId,
    itemId: normalizedInfo.itemId,
    mapId: normalizedInfo.mapId,
    quest: normalizedInfo.quest,
    cellId: normalizedInfo.cellId,
    enemy: normalizedInfo.enemy,
    rank: normalizedInfo.rank,
    isBoss: normalizedInfo.isBoss,
    teitokuLv: normalizedInfo.teitokuLv,
    mapLv: normalizedInfo.mapLv,
    enemyShips1: normalizedInfo.enemyShips1,
    enemyShips2: normalizedInfo.enemyShips2,
    enemyFormation: normalizedInfo.enemyFormation,
    baseExp: normalizedInfo.baseExp,
    teitokuId: normalizedInfo.teitokuId,
    ownedShipSnapshot: normalizedInfo.ownedShipSnapshot,
    origin: normalizedInfo.origin,
    rawPayload: normalizedInfo,
  })
}

export const selectRank = async (info: ReportInfo): Promise<void> => {
  await getDb()
    .insert(selectRankRecords)
    .values({
      teitokuId: info.teitokuId,
      teitokuLv: info.teitokuLv,
      mapareaId: info.mapareaId,
      rank: info.rank,
      origin: info.origin,
      rawPayload: info,
    })
    .onConflictDoUpdate({
      target: [selectRankRecords.teitokuId, selectRankRecords.mapareaId],
      set: {
        teitokuLv: info.teitokuLv,
        rank: info.rank,
        origin: info.origin,
        rawPayload: info,
      },
    })
}

export const passEvent = async (info: ReportInfo): Promise<void> => {
  await getDb().insert(passEventRecords).values({
    teitokuId: info.teitokuId,
    teitokuLv: info.teitokuLv,
    mapId: info.mapId,
    mapLv: info.mapLv,
    rewards: info.rewards,
    origin: info.origin,
    rawPayload: info,
  })
}

export const knownQuests = async (): Promise<number[]> => {
  const records = await getDb().selectDistinct({ questId: quests.questId }).from(quests)
  const questIds = records.map((record) => record.questId)
  questIds.sort()
  return questIds
}

export const questNoop = async (): Promise<void> => {}

export const battleApi = async (info: ReportInfo): Promise<void> => {
  await getDb().insert(battleApis).values({
    origin: info.origin,
    path: info.path,
    data: info.data,
    rawPayload: info,
  })
}

export const nightContact = async (info: ReportInfo): Promise<void> => {
  await getDb().insert(nightContacts).values({
    fleetType: info.fleetType,
    shipId: info.shipId,
    shipLv: info.shipLv,
    itemId: info.itemId,
    itemLv: info.itemLv,
    contact: info.contact,
    rawPayload: info,
  })
}

export const aaci = async (info: ReportInfo): Promise<void> => {
  if (
    semver.gt(info.poiVersion, '7.9.1') &&
    info.origin.startsWith('Reporter ') &&
    semver.gte(info.origin.replace('Reporter ', ''), '3.6.0')
  ) {
    await getDb().insert(aaciRecords).values({
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
      rawPayload: info,
    })
  }
}

export const knownRecipes = async (): Promise<never[]> => []

export const remodelRecipe = async (info: ReportInfo): Promise<void> => {
  if (info.stage === -1) {
    return
  }

  const lastReported = Date.now()

  await getDb()
    .insert(recipeRecords)
    .values({
      recipeId: info.recipeId,
      itemId: info.itemId,
      stage: info.stage,
      day: info.day,
      secretary: info.secretary,
      fuel: info.fuel,
      ammo: info.ammo,
      steel: info.steel,
      bauxite: info.bauxite,
      reqItemId: info.reqItemId,
      reqItemCount: info.reqItemCount,
      buildkit: info.buildkit,
      remodelkit: info.remodelkit,
      certainBuildkit: info.certainBuildkit,
      certainRemodelkit: info.certainRemodelkit,
      upgradeToItemId: info.upgradeToItemId,
      upgradeToItemLevel: info.upgradeToItemLevel,
      lastReported,
      count: 1,
      key: info.key,
      origin: info.origin,
      rawPayload: info,
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
        fuel: info.fuel,
        ammo: info.ammo,
        steel: info.steel,
        bauxite: info.bauxite,
        reqItemId: info.reqItemId,
        reqItemCount: info.reqItemCount,
        buildkit: info.buildkit,
        remodelkit: info.remodelkit,
        certainBuildkit: info.certainBuildkit,
        certainRemodelkit: info.certainRemodelkit,
        upgradeToItemId: info.upgradeToItemId,
        upgradeToItemLevel: info.upgradeToItemLevel,
        lastReported,
        count: sql`${recipeRecords.count} + 1`,
        key: info.key,
        origin: info.origin,
        rawPayload: jsonbMerge(recipeRecords.rawPayload),
      },
    })
}

export const remodelRecipeDeduplicate = async (): Promise<unknown[]> => {
  // The PostgreSQL unique key prevents new duplicates, so legacy cleanup is normally a no-op.
  return []
}

export const nightBattleCi = async (info: ReportInfo): Promise<void> => {
  await getDb().insert(nightBattleCis).values({
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
    rawPayload: info,
  })
}

export const nightBattleSsCi = async (): Promise<void> => {}

export const shipStat = async (info: ReportInfo): Promise<void> => {
  const lastTimestamp = Date.now()

  await getDb()
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
      lastTimestamp,
      count: 1,
      rawPayload: info,
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
        lastTimestamp,
        count: sql`${shipStats.count} + 1`,
        rawPayload: jsonbMerge(shipStats.rawPayload),
      },
    })
}

export const enemyInfo = async (info: ReportInfo): Promise<void> => {
  const canonicalHash = createEnemyInfoHash(info)

  await getDb()
    .insert(enemyInfos)
    .values({
      canonicalHash,
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
      bombersMin: info.bombersMin,
      bombersMax: info.bombersMax,
      count: 1,
      rawPayload: info,
    })
    .onConflictDoUpdate({
      target: enemyInfos.canonicalHash,
      set: {
        bombersMin: sql`greatest(${enemyInfos.bombersMin}, excluded.bombers_min)`,
        bombersMax: sql`least(${enemyInfos.bombersMax}, excluded.bombers_max)`,
        count: sql`${enemyInfos.count} + 1`,
        rawPayload: jsonbMerge(enemyInfos.rawPayload),
      },
    })
}
