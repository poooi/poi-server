import * as mongoHandlers from './v2.handlers'
import semver from 'semver'
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

const handleSqliteReportError = (err: Error, request: AppRequest): AppResult => {
  if (err instanceof SqliteWriteQueueFullError) {
    return serviceUnavailable(err.message)
  }
  return handleReportError(err, request)
}

export const createShip = async (request: AppRequest): Promise<AppResult> => {
  try {
    await insertCreateShipRecord(parseReportInfo(request))
    return ok()
  } catch (err) {
    return handleSqliteReportError(err, request)
  }
}

export const createItem = async (request: AppRequest): Promise<AppResult> => {
  try {
    await insertCreateItemRecord(parseReportInfo(request))
    return ok()
  } catch (err) {
    return handleSqliteReportError(err, request)
  }
}

export const dropShip = async (request: AppRequest): Promise<AppResult> => {
  try {
    await insertDropShipRecord(parseReportInfo(request))
    return ok()
  } catch (err) {
    return handleSqliteReportError(err, request)
  }
}

export const nightContact = async (request: AppRequest): Promise<AppResult> => {
  try {
    await insertNightContactRecord(parseReportInfo(request))
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
      await insertAACIRecord(info)
    }
    return ok()
  } catch (err) {
    return handleSqliteReportError(err, request)
  }
}

export const selectRank = async (request: AppRequest): Promise<AppResult> => {
  try {
    await runSqliteWrite('operational', () => upsertSelectRankRecord(parseReportInfo(request)))
    return ok()
  } catch (err) {
    return handleSqliteReportError(err, request)
  }
}

export const remodelRecipe = async (request: AppRequest): Promise<AppResult> => {
  try {
    const info = parseReportInfo(request)
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
    await runSqliteWrite('operational', () => upsertShipStatRecord(parseReportInfo(request)))
    return ok()
  } catch (err) {
    return handleSqliteReportError(err, request)
  }
}

export const enemyInfo = async (request: AppRequest): Promise<AppResult> => {
  try {
    await runSqliteWrite('operational', () => upsertEnemyInfoRecord(parseReportInfo(request)))
    return ok()
  } catch (err) {
    return handleSqliteReportError(err, request)
  }
}

const saveOperationalRecord = async (request: AppRequest, kind: string): Promise<AppResult> => {
  try {
    await runSqliteWrite('operational', () =>
      insertOperationalRecord(kind, parseReportInfo(request)),
    )
    return ok()
  } catch (err) {
    return handleSqliteReportError(err, request)
  }
}

export const remodelItem = (request: AppRequest) => saveOperationalRecord(request, 'remodel_item')
export const passEvent = (request: AppRequest) => saveOperationalRecord(request, 'pass_event')
export const knownQuests = async (): Promise<AppResult> => ok({ quests: getKnownQuestIds() })
export const questNoop = mongoHandlers.questNoop
export const battleApi = (request: AppRequest) => saveOperationalRecord(request, 'battle_api')
export const knownRecipes = mongoHandlers.knownRecipes
export const remodelRecipeDeduplicate = async (): Promise<AppResult> => ok({ recipes: [] })
export const nightBattleCi = (request: AppRequest) =>
  saveOperationalRecord(request, 'night_battle_ci')
export const nightBattleSsCi = mongoHandlers.nightBattleSsCi
