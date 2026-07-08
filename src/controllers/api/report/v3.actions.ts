import { type AppRequest } from '../../../http/request'
import { type QuestRewardPayload } from '../../../models'
import { type ItemImprovementRecipeExportResult } from './v3.item-improvement.shared'

import { type DatabaseBackend } from '../../../db/backend'

import * as mongoActions from './v3.mongo.actions'
import * as postgresActions from './v3.postgres.actions'

export interface V3Actions {
  itemImprovementRecipe(request: AppRequest): Promise<number>
  itemImprovementRecipeAvailability(
    request: AppRequest,
  ): Promise<ItemImprovementRecipeExportResult<any>>
  itemImprovementRecipeCosts(request: AppRequest): Promise<ItemImprovementRecipeExportResult<any>>
  itemImprovementRecipeUpdates(request: AppRequest): Promise<ItemImprovementRecipeExportResult<any>>
  knownQuests(): Promise<string[]>
  quest(info: Record<string, any>): Promise<void>
  questReward(info: QuestRewardPayload): Promise<void>
  isItemImprovementValidationError: typeof mongoActions.isItemImprovementValidationError
  getItemImprovementRecipeValidationErrorMessage: typeof mongoActions.getItemImprovementRecipeValidationErrorMessage
}

export const getV3Actions = (backend: DatabaseBackend): V3Actions => {
  if (backend === 'mongodb') {
    return mongoActions
  }

  return postgresActions
}
