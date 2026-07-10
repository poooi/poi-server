import crypto from 'crypto'
import _ from 'lodash'

import { withCloudflareCache } from '../../../http/cache-control'
import { type AppRequest } from '../../../http/request'
import { badRequest, ok, serviceUnavailable, type AppResult } from '../../../http/result'
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

const createHash = _.memoize((text) => crypto.createHash('md5').update(text).digest('hex'))
const validItemImprovementSources = new Set(['list', 'detail', 'execution'])
const itemImprovementMaxBatchSize = 100

class ItemImprovementValidationError extends Error {}

const createQuestHash = ({ title, detail }: QuestPayload | QuestRewardPayload) =>
  createHash(`${title}${detail}`)

const handleSqliteReportError = (err: Error, request: AppRequest): AppResult => {
  if (err instanceof SqliteWriteQueueFullError) {
    return serviceUnavailable(err.message)
  }
  return handleReportError(err, request)
}

const parseInteger = (value: unknown, fallback: number, field: string) => {
  if (value == null) {
    return fallback
  }
  const text = String(value)
  if (!/^-?\d+$/.test(text)) {
    throw new Error(`${field}: must be an integer`)
  }
  return parseInt(text, 10)
}

const parseExportCursor = (request: AppRequest) => {
  const limit = parseInteger(request.query.limit, 500, 'limit')
  const updatedAfter = parseInteger(request.query.updatedAfter, 0, 'updatedAfter')
  if (limit <= 0) {
    throw new Error('limit: must be positive')
  }
  if (updatedAfter < 0) {
    throw new Error('updatedAfter: must be non-negative')
  }
  const afterId = request.query.afterId == null ? undefined : String(request.query.afterId)
  if (afterId != null && !/^[a-f0-9]{24}$/.test(afterId)) {
    throw new Error('afterId: must be a valid ObjectId')
  }
  if (afterId != null && BigInt(`0x${afterId}`) > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('afterId: is outside SQLite cursor range')
  }
  return {
    afterId,
    limit: Math.min(limit, 1000),
    updatedAfter,
  }
}

const isInteger = (value: unknown) =>
  typeof value === 'number'
    ? Number.isInteger(value)
    : typeof value === 'string' && /^-?\d+$/.test(value)

const toInteger = (value: unknown) =>
  typeof value === 'number' ? value : parseInt(String(value), 10)

const validatePositiveInteger = (record: Record<string, any>, field: string) => {
  if (!isInteger(record[field]) || toInteger(record[field]) <= 0) {
    throw new ItemImprovementValidationError(`${field}: must be a positive integer`)
  }
}

const validateNonNegativeInteger = (record: Record<string, any>, field: string) => {
  if (!isInteger(record[field]) || toInteger(record[field]) < 0) {
    throw new ItemImprovementValidationError(`${field}: must be a non-negative integer`)
  }
}

const normalizeItemImprovementRecord = (
  record: Record<string, any>,
  serverReceivedAt: number,
): Record<string, any> => {
  if (!validItemImprovementSources.has(record.source)) {
    throw new ItemImprovementValidationError('source: Invalid option')
  }

  validatePositiveInteger(record, 'schemaVersion')
  validatePositiveInteger(record, 'recipeId')
  validatePositiveInteger(record, 'itemId')
  validateNonNegativeInteger(record, 'observedSecondShipId')
  if (!isInteger(record.day) || toInteger(record.day) < 0 || toInteger(record.day) > 6) {
    throw new ItemImprovementValidationError('day: must be between 0 and 6')
  }
  if (
    !isInteger(record.clientObservedAt) ||
    toInteger(record.clientObservedAt) < Date.UTC(2013, 3, 23) ||
    toInteger(record.clientObservedAt) > serverReceivedAt + 10 * 60 * 1000
  ) {
    throw new ItemImprovementValidationError('clientObservedAt: is not a plausible timestamp')
  }

  const normalized: Record<string, any> = {
    ...record,
    clientObservedAt: toInteger(record.clientObservedAt),
    day: toInteger(record.day),
    itemId: toInteger(record.itemId),
    observedSecondShipId: toInteger(record.observedSecondShipId),
    recipeId: toInteger(record.recipeId),
    schemaVersion: toInteger(record.schemaVersion),
  }

  if (record.source === 'detail') {
    ;[
      'itemLevel',
      'stage',
      'fuel',
      'ammo',
      'steel',
      'bauxite',
      'buildkit',
      'remodelkit',
      'certainBuildkit',
      'certainRemodelkit',
    ].forEach((field) => validateNonNegativeInteger(record, field))
    if (!Array.isArray(record.reqSlotItems) || !Array.isArray(record.reqUseItems)) {
      throw new ItemImprovementValidationError('required items: must be arrays')
    }
    ;[
      'itemLevel',
      'stage',
      'fuel',
      'ammo',
      'steel',
      'bauxite',
      'buildkit',
      'remodelkit',
      'certainBuildkit',
      'certainRemodelkit',
    ].forEach((field) => {
      normalized[field] = toInteger(record[field])
    })
    normalized.changeFlag = record.changeFlag == null ? 0 : toInteger(record.changeFlag)
  }

  if (record.source === 'execution') {
    validateNonNegativeInteger(record, 'itemLevel')
    validatePositiveInteger(record, 'upgradeToItemId')
    validateNonNegativeInteger(record, 'upgradeToItemLevel')
    if (record.upgradeObserved !== true) {
      throw new ItemImprovementValidationError('upgradeObserved: Invalid literal value')
    }
    normalized.itemLevel = toInteger(record.itemLevel)
    normalized.upgradeToItemId = toInteger(record.upgradeToItemId)
    normalized.upgradeToItemLevel = toInteger(record.upgradeToItemLevel)
  }

  return normalized
}

const createNextCursor = (records: Array<{ _id: string; lastReported: number }>, limit: number) => {
  if (records.length < limit) {
    return null
  }
  const last = records[records.length - 1]
  return {
    afterId: last._id,
    updatedAfter: last.lastReported,
  }
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
    await runSqliteWrite('operational', () => upsertQuestRecords(records))
    return ok()
  } catch (err) {
    return handleSqliteReportError(err, request)
  }
}

export const questReward = async (request: AppRequest): Promise<AppResult> => {
  try {
    const info = parseReportInfo(request) as QuestRewardPayload
    await runSqliteWrite('operational', () =>
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
    const rawRecords = Array.isArray(info.records) ? info.records : [info]
    if (rawRecords.length > itemImprovementMaxBatchSize) {
      return badRequest('records: Too big: expected array to have <=100 items')
    }
    const serverReceivedAt = Date.now()
    const records = rawRecords.map((record) =>
      normalizeItemImprovementRecord(record, serverReceivedAt),
    )

    await runSqliteWrite('operational', () => {
      for (const record of records) {
        if (record.source === 'list') {
          upsertItemImprovementAvailabilityFact(record, serverReceivedAt)
        } else if (record.source === 'detail') {
          upsertItemImprovementCostFact(record, serverReceivedAt)
        } else if (record.source === 'execution') {
          upsertItemImprovementUpdateFact(record, serverReceivedAt)
        }
      }
    })
    return ok({ records: records.length })
  } catch (err) {
    if (err instanceof ItemImprovementValidationError) {
      return badRequest(err.message)
    }
    return handleSqliteReportError(err, request)
  }
}

export const itemImprovementRecipeAvailability = async (
  request: AppRequest,
): Promise<AppResult> => {
  let cursor: ReturnType<typeof parseExportCursor>
  try {
    cursor = parseExportCursor(request)
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : String(err))
  }
  const records = getItemImprovementAvailabilityFacts(cursor).map((row) => ({
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
  }))
  return withCloudflareCache(
    request,
    ok({
      records,
      next: createNextCursor(records, cursor.limit),
    }),
  )
}

export const itemImprovementRecipeCosts = async (request: AppRequest): Promise<AppResult> => {
  let cursor: ReturnType<typeof parseExportCursor>
  try {
    cursor = parseExportCursor(request)
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : String(err))
  }
  const records = getItemImprovementCostFacts(cursor).map((row) => ({
    _id: row.id.toString(16).padStart(24, '0'),
    ammo: row.ammo,
    bauxite: row.bauxite,
    buildkit: row.buildkit,
    certainBuildkit: row.certain_buildkit,
    certainRemodelkit: row.certain_remodelkit,
    count: row.count,
    day: row.day,
    firstClientObservedAt: row.first_client_observed_at,
    firstReported: row.first_reported,
    fuel: row.fuel,
    itemId: row.item_id,
    itemLevel: row.item_level,
    lastClientObservedAt: row.last_client_observed_at,
    lastReported: row.last_reported,
    observedFlagshipIds: JSON.parse(row.observed_flagship_ids_json),
    observedSecondShipId: row.observed_second_ship_id,
    recipeId: row.recipe_id,
    remodelkit: row.remodelkit,
    reqSlotItems: JSON.parse(row.req_slot_items_json),
    reqUseItems: JSON.parse(row.req_use_items_json),
    schemaVersion: row.schema_version,
    sources: JSON.parse(row.sources_json),
    stage: row.stage,
    steel: row.steel,
  }))
  return withCloudflareCache(
    request,
    ok({
      records,
      next: createNextCursor(records, cursor.limit),
    }),
  )
}

export const itemImprovementRecipeUpdates = async (request: AppRequest): Promise<AppResult> => {
  let cursor: ReturnType<typeof parseExportCursor>
  try {
    cursor = parseExportCursor(request)
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : String(err))
  }
  const records = getItemImprovementUpdateFacts(cursor).map((row) => ({
    _id: row.id.toString(16).padStart(24, '0'),
    count: row.count,
    day: row.day,
    firstClientObservedAt: row.first_client_observed_at,
    firstReported: row.first_reported,
    itemId: row.item_id,
    itemLevel: row.item_level,
    lastClientObservedAt: row.last_client_observed_at,
    lastReported: row.last_reported,
    observedFlagshipIds: JSON.parse(row.observed_flagship_ids_json),
    observedSecondShipId: row.observed_second_ship_id,
    recipeId: row.recipe_id,
    schemaVersion: row.schema_version,
    sources: JSON.parse(row.sources_json),
    upgradeObserved: Boolean(row.upgrade_observed),
    upgradeToItemId: row.upgrade_to_item_id,
    upgradeToItemLevel: row.upgrade_to_item_level,
  }))
  return withCloudflareCache(
    request,
    ok({
      records,
      next: createNextCursor(records, cursor.limit),
    }),
  )
}
