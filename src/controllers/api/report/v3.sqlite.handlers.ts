import crypto from 'crypto'
import _ from 'lodash'

import { withCloudflareCache } from '../../../http/cache-control'
import { type AppRequest } from '../../../http/request'
import { ok, type AppResult } from '../../../http/result'
import {
  upsertQuestRecords,
  getKnownQuestKeys,
  upsertQuestRewardRecord,
  upsertItemImprovementAvailabilityFact,
  getItemImprovementAvailabilityFacts,
  upsertItemImprovementCostFact,
  upsertItemImprovementUpdateFact,
  getItemImprovementCostFacts,
  getItemImprovementUpdateFacts,
} from '../../../db/sqlite/operational'
import { runSqliteWrite, SqliteWriteQueueFullError } from '../../../db/sqlite/write-queue'
import { handleReportError, parseReportInfo } from './shared'
import { type QuestPayload, type QuestRewardPayload } from '../../../models'
import { serviceUnavailable } from '../../../http/result'

const createHash = _.memoize((text) => crypto.createHash('md5').update(text).digest('hex'))

const createQuestHash = ({ title, detail }: QuestPayload | QuestRewardPayload) =>
  createHash(`${title}${detail}`)

const handleSqliteReportError = (err: Error, request: AppRequest): AppResult => {
  if (err instanceof SqliteWriteQueueFullError) {
    return serviceUnavailable(err.message)
  }
  return handleReportError(err, request)
}

export const knownQuests = async (request: AppRequest): Promise<AppResult> =>
  withCloudflareCache(
    request,
    ok({
      quests: getKnownQuestKeys().map((key) => key.slice(0, 8)),
    }),
  )

export const quest = async (request: AppRequest): Promise<AppResult> => {
  try {
    const info = parseReportInfo(request)
    const records = _.map(info.quests, (questItem) => ({
      ...questItem,
      key: createQuestHash(questItem),
      origin: info.origin,
    }))
    await runSqliteWrite(() => upsertQuestRecords(records))
    return ok()
  } catch (err) {
    return handleSqliteReportError(err, request)
  }
}

export const questReward = async (request: AppRequest): Promise<AppResult> => {
  try {
    const info = parseReportInfo(request) as QuestRewardPayload
    await runSqliteWrite(() =>
      upsertQuestRewardRecord({
        ...info,
        key: createQuestHash(info),
      }),
    )
    return ok()
  } catch (err) {
    return handleSqliteReportError(err, request)
  }
}

export const itemImprovementRecipe = async (request: AppRequest): Promise<AppResult> => {
  try {
    const info = parseReportInfo(request)
    if (info.source === 'list') {
      await runSqliteWrite(() => upsertItemImprovementAvailabilityFact(info))
    } else if (info.source === 'detail') {
      await runSqliteWrite(() => upsertItemImprovementCostFact(info))
    } else if (info.source === 'execution') {
      await runSqliteWrite(() => upsertItemImprovementUpdateFact(info))
    }
    return ok({ records: 1 })
  } catch (err) {
    return handleSqliteReportError(err, request)
  }
}

export const itemImprovementRecipeAvailability = async (request: AppRequest): Promise<AppResult> =>
  withCloudflareCache(
    request,
    ok({
      records: getItemImprovementAvailabilityFacts().map((row) => ({
        _id: row.id.toString(16).padStart(24, '0'),
        count: row.count,
        day: row.day,
        firstClientObservedAt: row.first_client_observed_at,
        firstReported: row.first_reported,
        itemId: row.item_id,
        lastClientObservedAt: row.last_client_observed_at,
        lastReported: row.last_reported,
        observedFlagshipIds: JSON.parse(row.observed_flagship_ids_json),
        observedSecondShipId: row.observed_second_ship_id,
        recipeId: row.recipe_id,
        schemaVersion: row.schema_version,
        sources: JSON.parse(row.sources_json),
      })),
      next: null,
    }),
  )

export const itemImprovementRecipeCosts = async (request: AppRequest): Promise<AppResult> =>
  withCloudflareCache(
    request,
    ok({
      records: getItemImprovementCostFacts().map((row) => ({
        _id: row.id.toString(16).padStart(24, '0'),
        count: row.count,
        itemId: row.item_id,
        itemLevel: row.item_level,
        observedSecondShipId: row.observed_second_ship_id,
        recipeId: row.recipe_id,
        reqSlotItems: JSON.parse(row.req_slot_items_json),
        reqUseItems: JSON.parse(row.req_use_items_json),
        sources: JSON.parse(row.sources_json),
      })),
      next: null,
    }),
  )

export const itemImprovementRecipeUpdates = async (request: AppRequest): Promise<AppResult> =>
  withCloudflareCache(
    request,
    ok({
      records: getItemImprovementUpdateFacts().map((row) => ({
        _id: row.id.toString(16).padStart(24, '0'),
        count: row.count,
        itemId: row.item_id,
        itemLevel: row.item_level,
        observedSecondShipId: row.observed_second_ship_id,
        recipeId: row.recipe_id,
        sources: JSON.parse(row.sources_json),
        upgradeObserved: Boolean(row.upgrade_observed),
        upgradeToItemId: row.upgrade_to_item_id,
        upgradeToItemLevel: row.upgrade_to_item_level,
      })),
      next: null,
    }),
  )
