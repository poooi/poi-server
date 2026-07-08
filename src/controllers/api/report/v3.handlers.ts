import { config } from '../../../config'
import { resolveBackend } from '../../../db/backend'
import { withCloudflareCache } from '../../../http/cache-control'
import { type AppRequest } from '../../../http/request'
import { badRequest, internalServerError, ok, type AppResult } from '../../../http/result'
import { captureException } from '../../../sentry'
import { type QuestRewardPayload } from '../../../models'
import { getV3Actions } from './v3.actions'
import { handleReportError, parseReportInfo } from './shared'

// TODO(postgres): inject backend selection through route registration once multiple backends are wired.
const actions = getV3Actions(resolveBackend(config.db))

export const itemImprovementRecipe = async (request: AppRequest): Promise<AppResult> => {
  try {
    return ok({ records: await actions.itemImprovementRecipe(request) })
  } catch (err) {
    if (actions.isItemImprovementValidationError(err)) {
      return badRequest(actions.getItemImprovementRecipeValidationErrorMessage(err))
    }

    captureException(err, request)
    return internalServerError()
  }
}

export const itemImprovementRecipeAvailability = async (
  request: AppRequest,
): Promise<AppResult> => {
  try {
    return withCloudflareCache(
      request,
      ok(await actions.itemImprovementRecipeAvailability(request)),
    )
  } catch (err) {
    if (actions.isItemImprovementValidationError(err)) {
      return badRequest(actions.getItemImprovementRecipeValidationErrorMessage(err))
    }

    captureException(err, request)
    return internalServerError()
  }
}

export const itemImprovementRecipeCosts = async (request: AppRequest): Promise<AppResult> => {
  try {
    return withCloudflareCache(request, ok(await actions.itemImprovementRecipeCosts(request)))
  } catch (err) {
    if (actions.isItemImprovementValidationError(err)) {
      return badRequest(actions.getItemImprovementRecipeValidationErrorMessage(err))
    }

    captureException(err, request)
    return internalServerError()
  }
}

export const itemImprovementRecipeUpdates = async (request: AppRequest): Promise<AppResult> => {
  try {
    return withCloudflareCache(request, ok(await actions.itemImprovementRecipeUpdates(request)))
  } catch (err) {
    if (actions.isItemImprovementValidationError(err)) {
      return badRequest(actions.getItemImprovementRecipeValidationErrorMessage(err))
    }

    captureException(err, request)
    return internalServerError()
  }
}

export const knownQuests = async (request: AppRequest): Promise<AppResult> => {
  try {
    return withCloudflareCache(request, ok({ quests: await actions.knownQuests() }))
  } catch (err) {
    captureException(err, request)
    return internalServerError()
  }
}

export const quest = async (request: AppRequest): Promise<AppResult> => {
  try {
    await actions.quest(parseReportInfo(request))
    return ok()
  } catch (err) {
    return handleReportError(err, request)
  }
}

export const questReward = async (request: AppRequest): Promise<AppResult> => {
  try {
    await actions.questReward(parseReportInfo(request) as QuestRewardPayload)
    return ok()
  } catch (err) {
    return handleReportError(err, request)
  }
}
