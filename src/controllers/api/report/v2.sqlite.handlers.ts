import * as mongoHandlers from './v2.handlers'
import { type Document } from 'mongoose'
import semver from 'semver'
import { withCloudflareCache } from '../../../http/cache-control'
import { ok, serviceUnavailable, type AppResult } from '../../../http/result'
import {
  insertAACIRecord,
  insertCreateItemRecord,
  insertCreateShipRecord,
  insertDropShipRecord,
  insertNightContactRecord,
} from '../../../db/sqlite/append-only'
import {
  upsertEnemyInfoRecord,
  upsertRecipeRecord,
  upsertSelectRankRecord,
  upsertShipStatRecord,
  insertOperationalRecord,
  getKnownQuestIds,
} from '../../../db/sqlite/operational'
import { runSqliteWrite, SqliteWriteQueueFullError } from '../../../db/sqlite/write-queue'
import { handleReportError, parseReportInfo } from './shared'
import { type AppRequest } from '../../../http/request'
import {
  AACIRecord,
  BattleAPI,
  CreateItemRecord,
  CreateShipRecord,
  DropShipRecord,
  EnemyInfo,
  NightBattleCI,
  NightContactRecord,
  PassEventRecord,
  RecipeRecord,
  RemodelItemRecord,
  SelectRankRecord,
  ShipStat,
} from '../../../models'

const handleSqliteReportError = (err: Error, request: AppRequest): AppResult => {
  if (err instanceof SqliteWriteQueueFullError) {
    return serviceUnavailable(err.message)
  }
  return handleReportError(err, request)
}

const normalizeSqliteRecord = (record: Document): Record<string, any> => {
  const validationError = record.validateSync()
  if (validationError != null) {
    throw validationError
  }
  return record.toObject({ minimize: false })
}

export const createShip = async (request: AppRequest): Promise<AppResult> => {
  try {
    await insertCreateShipRecord(
      normalizeSqliteRecord(new CreateShipRecord(parseReportInfo(request))),
    )
    return ok()
  } catch (err) {
    return handleSqliteReportError(err, request)
  }
}

export const createItem = async (request: AppRequest): Promise<AppResult> => {
  try {
    await insertCreateItemRecord(
      normalizeSqliteRecord(new CreateItemRecord(parseReportInfo(request))),
    )
    return ok()
  } catch (err) {
    return handleSqliteReportError(err, request)
  }
}

export const dropShip = async (request: AppRequest): Promise<AppResult> => {
  try {
    const record = new DropShipRecord(parseReportInfo(request))
    if (record.mapId < 73) {
      record.ownedShipSnapshot = {}
    }
    await insertDropShipRecord(normalizeSqliteRecord(record))
    return ok()
  } catch (err) {
    return handleSqliteReportError(err, request)
  }
}

export const nightContact = async (request: AppRequest): Promise<AppResult> => {
  try {
    await insertNightContactRecord(
      normalizeSqliteRecord(new NightContactRecord(parseReportInfo(request))),
    )
    return ok()
  } catch (err) {
    return handleSqliteReportError(err, request)
  }
}

export const aaci = async (request: AppRequest): Promise<AppResult> => {
  try {
    const info = parseReportInfo(request)
    if (
      semver.gt(info.poiVersion, '7.9.1') &&
      info.origin.startsWith('Reporter ') &&
      semver.gte(info.origin.replace('Reporter ', ''), '3.6.0')
    ) {
      await insertAACIRecord(normalizeSqliteRecord(new AACIRecord(info)))
    }
    return ok()
  } catch (err) {
    return handleSqliteReportError(err, request)
  }
}

export const selectRank = async (request: AppRequest): Promise<AppResult> => {
  try {
    const info = normalizeSqliteRecord(new SelectRankRecord(parseReportInfo(request)))
    await runSqliteWrite('operational', () => upsertSelectRankRecord(info))
    return ok()
  } catch (err) {
    return handleSqliteReportError(err, request)
  }
}

export const remodelRecipe = async (request: AppRequest): Promise<AppResult> => {
  try {
    const info = normalizeSqliteRecord(new RecipeRecord(parseReportInfo(request)))
    if (info.stage !== -1) {
      await runSqliteWrite('operational', () => upsertRecipeRecord(info))
    }
    return ok()
  } catch (err) {
    return handleSqliteReportError(err, request)
  }
}

export const shipStat = async (request: AppRequest): Promise<AppResult> => {
  try {
    const info = normalizeSqliteRecord(new ShipStat(parseReportInfo(request)))
    await runSqliteWrite('operational', () => upsertShipStatRecord(info))
    return ok()
  } catch (err) {
    return handleSqliteReportError(err, request)
  }
}

export const enemyInfo = async (request: AppRequest): Promise<AppResult> => {
  try {
    const info = normalizeSqliteRecord(new EnemyInfo(parseReportInfo(request)))
    await runSqliteWrite('operational', () => upsertEnemyInfoRecord(info))
    return ok()
  } catch (err) {
    return handleSqliteReportError(err, request)
  }
}

const saveOperationalRecord = async (
  request: AppRequest,
  kind: string,
  createRecord: (info: Record<string, any>) => Document,
): Promise<AppResult> => {
  try {
    const info = normalizeSqliteRecord(createRecord(parseReportInfo(request)))
    await runSqliteWrite('operational', () => insertOperationalRecord(kind, info))
    return ok()
  } catch (err) {
    return handleSqliteReportError(err, request)
  }
}

export const remodelItem = (request: AppRequest) =>
  saveOperationalRecord(request, 'remodel_item', (info) => new RemodelItemRecord(info))
export const passEvent = (request: AppRequest) =>
  saveOperationalRecord(request, 'pass_event', (info) => new PassEventRecord(info))
export const knownQuests = async (request: AppRequest): Promise<AppResult> =>
  withCloudflareCache(request, ok({ quests: getKnownQuestIds() }))
export const questNoop = mongoHandlers.questNoop
export const battleApi = (request: AppRequest) =>
  saveOperationalRecord(request, 'battle_api', (info) => new BattleAPI(info))
export const knownRecipes = mongoHandlers.knownRecipes
export const remodelRecipeDeduplicate = async (_request: AppRequest): Promise<AppResult> => {
  void _request
  return ok({ recipes: [] })
}
export const nightBattleCi = (request: AppRequest) =>
  saveOperationalRecord(request, 'night_battle_ci', (info) => new NightBattleCI(info))
export const nightBattleSsCi = mongoHandlers.nightBattleSsCi
