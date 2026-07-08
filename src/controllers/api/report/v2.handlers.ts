import { config } from '../../../config'
import { resolveBackend } from '../../../db/backend'
import { withCloudflareCache } from '../../../http/cache-control'
import { type AppRequest } from '../../../http/request'
import { internalServerError, ok, type AppResult } from '../../../http/result'
import { captureException } from '../../../sentry'
import { getV2Actions } from './v2.actions'
import { handleReportError, parseReportInfo } from './shared'

// TODO(postgres): inject backend selection through route registration once multiple backends are wired.
const actions = getV2Actions(resolveBackend(config.db))

const saveReportRecord = async (
  request: AppRequest,
  saveAction: (info: Record<string, any>) => Promise<unknown>,
): Promise<AppResult> => {
  try {
    const info = parseReportInfo(request)
    await saveAction(info)
    return ok()
  } catch (err) {
    return handleReportError(err, request)
  }
}

export const createShip = (request: AppRequest) => saveReportRecord(request, actions.createShip)

export const createItem = (request: AppRequest) => saveReportRecord(request, actions.createItem)

export const remodelItem = (request: AppRequest) => saveReportRecord(request, actions.remodelItem)

export const dropShip = async (request: AppRequest): Promise<AppResult> => {
  try {
    await actions.dropShip(parseReportInfo(request))
    return ok()
  } catch (err) {
    return handleReportError(err, request)
  }
}

export const selectRank = async (request: AppRequest): Promise<AppResult> => {
  try {
    await actions.selectRank(parseReportInfo(request))
    return ok()
  } catch (err) {
    return handleReportError(err, request)
  }
}

export const passEvent = (request: AppRequest) => saveReportRecord(request, actions.passEvent)

export const knownQuests = async (request: AppRequest): Promise<AppResult> => {
  try {
    return withCloudflareCache(request, ok({ quests: await actions.knownQuests() }))
  } catch (err) {
    captureException(err, request)
    return internalServerError()
  }
}

export const questNoop = async (): Promise<AppResult> => {
  await actions.questNoop()
  return ok()
}

export const battleApi = (request: AppRequest) => saveReportRecord(request, actions.battleApi)

export const nightContact = (request: AppRequest) => saveReportRecord(request, actions.nightContact)

export const aaci = async (request: AppRequest): Promise<AppResult> => {
  try {
    await actions.aaci(parseReportInfo(request))
    return ok()
  } catch (err) {
    return handleReportError(err, request)
  }
}

export const knownRecipes = async (): Promise<AppResult> =>
  ok({ recipes: await actions.knownRecipes() })

export const remodelRecipe = async (request: AppRequest): Promise<AppResult> => {
  try {
    await actions.remodelRecipe(parseReportInfo(request))
    return ok()
  } catch (err) {
    return handleReportError(err, request)
  }
}

export const remodelRecipeDeduplicate = async (request: AppRequest): Promise<AppResult> => {
  try {
    return ok({ recipes: await actions.remodelRecipeDeduplicate() })
  } catch (err) {
    captureException(err, request)
    return internalServerError()
  }
}

export const nightBattleCi = (request: AppRequest) =>
  saveReportRecord(request, actions.nightBattleCi)

export const nightBattleSsCi = async (): Promise<AppResult> => {
  await actions.nightBattleSsCi()
  return ok()
}

export const shipStat = async (request: AppRequest): Promise<AppResult> => {
  try {
    await actions.shipStat(parseReportInfo(request))
    return ok()
  } catch (err) {
    return handleReportError(err, request)
  }
}

export const enemyInfo = async (request: AppRequest): Promise<AppResult> => {
  try {
    await actions.enemyInfo(parseReportInfo(request))
    return ok()
  } catch (err) {
    return handleReportError(err, request)
  }
}
