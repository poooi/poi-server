import mongoose from 'mongoose'
import crypto from 'crypto'
import _ from 'lodash'
import bluebird from 'bluebird'
import { z, ZodError } from 'zod'

import { withCloudflareCache } from '../../../http/cache-control'
import { legacyMongoEpoch } from '../../../contracts/database'
import { canonicalizeObjectIdCursor } from '../../../contracts/item-improvement'
import { getHeader, type AppRequest } from '../../../http/request'
import { badRequest, internalServerError, ok, type AppResult } from '../../../http/result'
import { captureException } from '../../../sentry'
import {
  ItemImprovementRecipeAvailabilityFact,
  ItemImprovementRecipeCostFact,
  ItemImprovementRecipeUpdateFact,
  type QuestPayload,
  type QuestRewardPayload,
  Quest,
  QuestReward,
  type QuestDocument,
  type RequiredItem,
} from '../../../models'
import { getRequestData, handleReportError, parseReportInfo } from './shared'

const createHash = _.memoize((text) => crypto.createHash('md5').update(text).digest('hex'))

const createQuestHash = ({ title, detail }: QuestPayload | QuestRewardPayload) =>
  createHash(`${title}${detail}`)

type ItemImprovementRecipeSource = 'list' | 'detail' | 'execution'

interface ItemImprovementRecipeBaseRecord {
  schemaVersion: number
  source: ItemImprovementRecipeSource
  clientObservedAt: number
  recipeId: number
  itemId: number
  day: number
  observedSecondShipId: number
  observedFlagshipIds: number[]
  origin?: string
}

interface ItemImprovementRecipeListRecord extends ItemImprovementRecipeBaseRecord {
  source: 'list'
}

interface ItemImprovementRecipeDetailRecord extends ItemImprovementRecipeBaseRecord {
  source: 'detail'
  itemLevel: number
  stage: number
  fuel: number
  ammo: number
  steel: number
  bauxite: number
  buildkit: number
  remodelkit: number
  certainBuildkit: number
  certainRemodelkit: number
  reqSlotItems: RequiredItem[]
  reqUseItems: RequiredItem[]
  changeFlag: number
}

interface ItemImprovementRecipeExecutionRecord extends ItemImprovementRecipeBaseRecord {
  source: 'execution'
  itemLevel: number
  upgradeObserved: true
  upgradeToItemId: number
  upgradeToItemLevel: number
}

type ItemImprovementRecipeRecord =
  | ItemImprovementRecipeListRecord
  | ItemImprovementRecipeDetailRecord
  | ItemImprovementRecipeExecutionRecord

interface ExportableItemImprovementFactDocument extends mongoose.Document {
  lastReported: number
}

class ItemImprovementRecipeValidationError extends Error {}

const ITEM_IMPROVEMENT_RECIPE_MAX_EXPORT_LIMIT = 1000
const ITEM_IMPROVEMENT_RECIPE_DEFAULT_EXPORT_LIMIT = 500
const ITEM_IMPROVEMENT_RECIPE_MAX_INGEST_BATCH_SIZE = 100
const ITEM_IMPROVEMENT_RECIPE_INGEST_CONCURRENCY = 10
const ITEM_IMPROVEMENT_RECIPE_JST_MIDNIGHT_TOLERANCE = 15 * 60 * 1000
const ITEM_IMPROVEMENT_RECIPE_MIN_TIMESTAMP = Date.UTC(2013, 3, 23)
const ITEM_IMPROVEMENT_RECIPE_MAX_FUTURE_SKEW = 10 * 60 * 1000
const REPORTER_ORIGIN_PATTERN = /^[A-Za-z][A-Za-z0-9 _./+-]{0,79}$/

const getJstDay = (time: number) => {
  const date = new Date(time)
  const utcDay = date.getUTCDay()
  const utcHour = date.getUTCHours()
  return utcHour >= 15 ? (utcDay + 1) % 7 : utcDay
}

const isNearJstMidnight = (time: number) => {
  const date = new Date(time)
  const utcMilliseconds =
    ((date.getUTCHours() * 60 + date.getUTCMinutes()) * 60 + date.getUTCSeconds()) * 1000 +
    date.getUTCMilliseconds()
  const jstMidnightMilliseconds = 15 * 60 * 60 * 1000
  const distance = Math.abs(utcMilliseconds - jstMidnightMilliseconds)
  return (
    distance <= ITEM_IMPROVEMENT_RECIPE_JST_MIDNIGHT_TOLERANCE ||
    24 * 60 * 60 * 1000 - distance <= ITEM_IMPROVEMENT_RECIPE_JST_MIDNIGHT_TOLERANCE
  )
}

const normalizeRequiredItems = (items: RequiredItem[]) => {
  const counts = new Map<number, number>()
  items.forEach(({ id, count }) => {
    if (id === 0 && count === 0) {
      return
    }
    counts.set(id, (counts.get(id) || 0) + count)
  })

  return Array.from(counts.keys())
    .sort((a, b) => a - b)
    .map((id) => ({ id, count: counts.get(id) as number }))
}

const integerSchema = z
  .union([z.number().int(), z.string().regex(/^-?\d+$/)])
  .transform((value) => (typeof value === 'number' ? value : parseInt(value, 10)))

const positiveIntSchema = integerSchema.refine((value) => value > 0, {
  message: 'must be a positive integer',
})

const nonNegativeIntSchema = integerSchema.refine((value) => value >= 0, {
  message: 'must be a non-negative integer',
})

const daySchema = integerSchema.refine((value) => value >= 0 && value <= 6, {
  message: 'must be between 0 and 6',
})

const createClientObservedAtSchema = (serverReceivedAt: number) =>
  integerSchema.refine(
    (value) =>
      value >= ITEM_IMPROVEMENT_RECIPE_MIN_TIMESTAMP &&
      value <= serverReceivedAt + ITEM_IMPROVEMENT_RECIPE_MAX_FUTURE_SKEW,
    { message: 'is not a plausible timestamp' },
  )

const requiredItemSchema = z.object({
  id: integerSchema,
  count: integerSchema,
})

const requiredItemsSchema = z
  .array(requiredItemSchema)
  .superRefine((items, ctx) => {
    items.forEach(({ id, count }, index) => {
      if (id === 0 && count === 0) {
        return
      }
      if (id <= 0 || count <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index],
          message: 'must contain positive id and count',
        })
      }
    })
  })
  .transform(normalizeRequiredItems)

const normalizeObservedFlagshipIds = (record: {
  observedFlagshipId?: number
  observedFlagshipIds?: number[]
}) => {
  const ids = new Set<number>()
  if (record.observedFlagshipId != null) {
    ids.add(record.observedFlagshipId)
  }
  if (record.observedFlagshipIds != null) {
    record.observedFlagshipIds.forEach((value) => ids.add(value))
  }
  return Array.from(ids).sort((a, b) => a - b)
}

const addObservedDayIssue = (
  record: { day: number; clientObservedAt: number },
  serverReceivedAt: number,
  ctx: z.RefinementCtx,
) => {
  if (record.day !== getJstDay(record.clientObservedAt)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['day'],
      message: 'does not match clientObservedAt JST day',
    })
  }

  if (
    record.day !== getJstDay(serverReceivedAt) &&
    !isNearJstMidnight(record.clientObservedAt) &&
    !isNearJstMidnight(serverReceivedAt)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['day'],
      message: 'does not match serverReceivedAt JST day',
    })
  }
}

const createCommonRecordShape = (serverReceivedAt: number) => ({
  schemaVersion: positiveIntSchema,
  clientObservedAt: createClientObservedAtSchema(serverReceivedAt),
  recipeId: positiveIntSchema,
  itemId: positiveIntSchema,
  day: daySchema,
  observedSecondShipId: nonNegativeIntSchema,
  observedFlagshipId: positiveIntSchema.optional(),
  observedFlagshipIds: z.array(positiveIntSchema).optional(),
})

const toRecordWithFlagshipIds = <
  TRecord extends {
    observedFlagshipId?: number
    observedFlagshipIds?: number[]
  },
>(
  record: TRecord,
) => {
  const { observedFlagshipId, observedFlagshipIds, ...rest } = record
  return {
    ...rest,
    observedFlagshipIds: normalizeObservedFlagshipIds({
      observedFlagshipId,
      observedFlagshipIds,
    }),
  }
}

const createItemImprovementRecipeRecordSchema = (serverReceivedAt: number) => {
  const commonShape = createCommonRecordShape(serverReceivedAt)
  const listRecordSchema = z
    .object({
      ...commonShape,
      source: z.literal('list'),
      reqSlotItems: requiredItemsSchema.optional(),
      reqUseItems: requiredItemsSchema.optional(),
    })
    .superRefine((record, ctx) => addObservedDayIssue(record, serverReceivedAt, ctx))
    .transform((record) => {
      const normalized = toRecordWithFlagshipIds(record)
      return {
        schemaVersion: normalized.schemaVersion,
        source: normalized.source,
        clientObservedAt: normalized.clientObservedAt,
        recipeId: normalized.recipeId,
        itemId: normalized.itemId,
        day: normalized.day,
        observedSecondShipId: normalized.observedSecondShipId,
        observedFlagshipIds: normalized.observedFlagshipIds,
      } as ItemImprovementRecipeListRecord
    })

  const detailRecordSchema = z
    .object({
      ...commonShape,
      source: z.literal('detail'),
      itemLevel: nonNegativeIntSchema,
      stage: nonNegativeIntSchema,
      fuel: nonNegativeIntSchema,
      ammo: nonNegativeIntSchema,
      steel: nonNegativeIntSchema,
      bauxite: nonNegativeIntSchema,
      buildkit: nonNegativeIntSchema,
      remodelkit: nonNegativeIntSchema,
      certainBuildkit: nonNegativeIntSchema,
      certainRemodelkit: nonNegativeIntSchema,
      reqSlotItems: requiredItemsSchema,
      reqUseItems: requiredItemsSchema,
      changeFlag: integerSchema.optional().default(0),
    })
    .superRefine((record, ctx) => addObservedDayIssue(record, serverReceivedAt, ctx))
    .transform((record) => toRecordWithFlagshipIds(record) as ItemImprovementRecipeDetailRecord)

  const executionRecordSchema = z
    .object({
      ...commonShape,
      source: z.literal('execution'),
      itemLevel: nonNegativeIntSchema,
      upgradeObserved: z.literal(true),
      upgradeToItemId: positiveIntSchema,
      upgradeToItemLevel: nonNegativeIntSchema,
    })
    .superRefine((record, ctx) => addObservedDayIssue(record, serverReceivedAt, ctx))
    .transform((record) => toRecordWithFlagshipIds(record) as ItemImprovementRecipeExecutionRecord)

  const sourceSchema = z.object({
    source: z.enum(['list', 'detail', 'execution']),
  })

  return {
    parse(value: unknown): ItemImprovementRecipeRecord {
      const { source } = sourceSchema.parse(value)
      if (source === 'list') {
        return listRecordSchema.parse(value)
      }
      if (source === 'detail') {
        return detailRecordSchema.parse(value)
      }
      return executionRecordSchema.parse(value)
    },
  }
}

const itemImprovementRecipeDataSchema = z
  .object({
    records: z.array(z.unknown()).max(ITEM_IMPROVEMENT_RECIPE_MAX_INGEST_BATCH_SIZE).optional(),
  })
  .catchall(z.unknown())

const exportCursorSchema = z
  .object({
    updatedAfter: integerSchema.optional().default(0),
    afterId: z.string().optional(),
    limit: integerSchema.optional().default(ITEM_IMPROVEMENT_RECIPE_DEFAULT_EXPORT_LIMIT),
  })
  .superRefine((cursor, ctx) => {
    if (cursor.updatedAfter < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['updatedAfter'],
        message: 'must be non-negative',
      })
    }
    if (cursor.limit <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['limit'],
        message: 'must be positive',
      })
    }
    if (cursor.afterId != null) {
      try {
        canonicalizeObjectIdCursor(cursor.afterId)
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['afterId'],
          message: 'must be a valid ObjectId',
        })
      }
    }
  })
  .transform((cursor) => ({
    ...cursor,
    afterId: cursor.afterId == null ? undefined : canonicalizeObjectIdCursor(cursor.afterId),
    limit: Math.min(cursor.limit, ITEM_IMPROVEMENT_RECIPE_MAX_EXPORT_LIMIT),
  }))

const getItemImprovementRecipeValidationErrorMessage = (
  err: ItemImprovementRecipeValidationError | ZodError,
): string => {
  if (err instanceof ItemImprovementRecipeValidationError) {
    return err.message
  }

  const issue = err.issues[0]
  if (issue == null) {
    return 'Invalid item improvement recipe payload'
  }
  const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
  return `${path}${issue.message}`
}

const isItemImprovementValidationError = (
  err: unknown,
): err is ItemImprovementRecipeValidationError | ZodError =>
  err instanceof ItemImprovementRecipeValidationError || err instanceof ZodError

const getReporterOrigin = (request: AppRequest) => {
  const origin = getHeader(request, 'x-reporter').trim()
  return REPORTER_ORIGIN_PATTERN.test(origin) ? origin : undefined
}

const parseJsonData = (data: unknown) => {
  if (!_.isString(data)) {
    return data
  }
  try {
    return JSON.parse(data)
  } catch {
    throw new ItemImprovementRecipeValidationError('data must be valid JSON')
  }
}

const parseItemImprovementRecipeData = (request: AppRequest) => {
  const parsedData = itemImprovementRecipeDataSchema.parse(
    parseJsonData(getRequestData(request.body)),
  )
  if (parsedData.records != null) {
    return parsedData.records
  }
  return [parsedData]
}

const normalizeItemImprovementRecipeRecord = (
  value: unknown,
  schema: ReturnType<typeof createItemImprovementRecipeRecordSchema>,
  origin: string | undefined,
): ItemImprovementRecipeRecord => {
  const record = schema.parse(value)
  return {
    ...record,
    origin,
  }
}

const serializeRequiredItems = (items: RequiredItem[]) =>
  items.length > 0 ? items.map(({ id, count }) => `${id}:${count}`).join(',') : '-'

const createAvailabilityKey = (record: ItemImprovementRecipeListRecord): string =>
  [
    'v1',
    'availability',
    record.recipeId,
    record.itemId,
    record.day,
    record.observedSecondShipId,
  ].join('|')

const createCostKey = (record: ItemImprovementRecipeDetailRecord): string =>
  [
    'v1',
    'cost',
    record.recipeId,
    record.itemId,
    record.itemLevel,
    record.stage,
    record.day,
    record.observedSecondShipId,
    record.fuel,
    record.ammo,
    record.steel,
    record.bauxite,
    record.buildkit,
    record.remodelkit,
    record.certainBuildkit,
    record.certainRemodelkit,
    serializeRequiredItems(record.reqSlotItems),
    serializeRequiredItems(record.reqUseItems),
    record.changeFlag,
  ].join('|')

const createUpdateKey = (record: ItemImprovementRecipeExecutionRecord): string =>
  [
    'v1',
    'update',
    record.recipeId,
    record.itemId,
    record.itemLevel,
    record.day,
    record.observedSecondShipId,
    record.upgradeToItemId,
    record.upgradeToItemLevel,
  ].join('|')

const createItemImprovementFactUpdate = (
  stableFields: Record<string, unknown>,
  record: ItemImprovementRecipeRecord,
  lastReported: number,
) => {
  const addToSet: Record<string, unknown> = {
    sources: record.source,
  }

  if (record.origin != null) {
    addToSet.origins = record.origin
  }
  if (record.observedFlagshipIds.length > 0) {
    addToSet.observedFlagshipIds = { $each: record.observedFlagshipIds }
  }

  return {
    $setOnInsert: {
      ...stableFields,
      firstReported: lastReported,
    },
    $min: {
      firstClientObservedAt: record.clientObservedAt,
    },
    $max: {
      lastReported,
      lastClientObservedAt: record.clientObservedAt,
    },
    $addToSet: addToSet,
    $inc: {
      count: 1,
    },
  }
}

const saveItemImprovementRecipeRecord = async (
  record: ItemImprovementRecipeRecord,
  lastReported: number,
): Promise<void> => {
  if (record.source === 'list') {
    const key = createAvailabilityKey(record)
    await ItemImprovementRecipeAvailabilityFact.updateOne(
      { key },
      createItemImprovementFactUpdate(
        {
          key,
          schemaVersion: record.schemaVersion,
          recipeId: record.recipeId,
          itemId: record.itemId,
          day: record.day,
          observedSecondShipId: record.observedSecondShipId,
        },
        record,
        lastReported,
      ),
      { upsert: true },
    )
    return
  }

  if (record.source === 'detail') {
    const key = createCostKey(record)
    await ItemImprovementRecipeCostFact.updateOne(
      { key },
      createItemImprovementFactUpdate(
        {
          key,
          schemaVersion: record.schemaVersion,
          recipeId: record.recipeId,
          itemId: record.itemId,
          itemLevel: record.itemLevel,
          stage: record.stage,
          day: record.day,
          observedSecondShipId: record.observedSecondShipId,
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
        },
        record,
        lastReported,
      ),
      { upsert: true },
    )
    return
  }

  const key = createUpdateKey(record)
  await ItemImprovementRecipeUpdateFact.updateOne(
    { key },
    createItemImprovementFactUpdate(
      {
        key,
        schemaVersion: record.schemaVersion,
        recipeId: record.recipeId,
        itemId: record.itemId,
        itemLevel: record.itemLevel,
        day: record.day,
        observedSecondShipId: record.observedSecondShipId,
        upgradeToItemId: record.upgradeToItemId,
        upgradeToItemLevel: record.upgradeToItemLevel,
        upgradeObserved: true,
      },
      record,
      lastReported,
    ),
    { upsert: true },
  )
}

const parseExportCursor = (request: AppRequest) =>
  exportCursorSchema.parse({
    updatedAfter: request.query.updatedAfter,
    afterId: request.query.afterId,
    limit: request.query.limit,
  })

const exportItemImprovementFacts = async <TDocument extends ExportableItemImprovementFactDocument>(
  request: AppRequest,
  model: mongoose.Model<TDocument>,
): Promise<AppResult> => {
  try {
    const { updatedAfter, afterId, limit } = parseExportCursor(request)
    const query = (
      afterId == null
        ? { lastReported: { $gt: updatedAfter } }
        : {
            $or: [
              { lastReported: { $gt: updatedAfter } },
              {
                lastReported: updatedAfter,
                _id: { $gt: new mongoose.Types.ObjectId(afterId) },
              },
            ],
          }
    ) as mongoose.FilterQuery<TDocument>

    const records = await model
      .find(query)
      // Export endpoints intentionally omit reporter origins to avoid exposing client-version
      // fingerprinting data. Stored fact documents keep origins for internal diagnostics.
      .select('-__v -origins')
      .sort({ lastReported: 1, _id: 1 })
      .limit(limit)
      .exec()
    const lastRecord = records[records.length - 1]

    return withCloudflareCache(
      request,
      ok({
        epoch: legacyMongoEpoch,
        records,
        next:
          lastRecord == null
            ? null
            : {
                updatedAfter: lastRecord.lastReported,
                afterId: lastRecord._id.toString(),
              },
      }),
    )
  } catch (err) {
    if (isItemImprovementValidationError(err)) {
      return badRequest(getItemImprovementRecipeValidationErrorMessage(err))
    }

    captureException(err, request)
    return internalServerError()
  }
}

export const itemImprovementRecipe = async (request: AppRequest): Promise<AppResult> => {
  try {
    const serverReceivedAt = Date.now()
    const origin = getReporterOrigin(request)
    const schema = createItemImprovementRecipeRecordSchema(serverReceivedAt)
    const records = parseItemImprovementRecipeData(request).map((record) =>
      normalizeItemImprovementRecipeRecord(record, schema, origin),
    )

    await bluebird.map(
      records,
      (record) => saveItemImprovementRecipeRecord(record, serverReceivedAt),
      { concurrency: ITEM_IMPROVEMENT_RECIPE_INGEST_CONCURRENCY },
    )

    return ok({ records: records.length })
  } catch (err) {
    if (isItemImprovementValidationError(err)) {
      return badRequest(getItemImprovementRecipeValidationErrorMessage(err))
    }

    captureException(err, request)
    return internalServerError()
  }
}

export const itemImprovementRecipeAvailability = (request: AppRequest) =>
  exportItemImprovementFacts(request, ItemImprovementRecipeAvailabilityFact)

export const itemImprovementRecipeCosts = (request: AppRequest) =>
  exportItemImprovementFacts(request, ItemImprovementRecipeCostFact)

export const itemImprovementRecipeUpdates = (request: AppRequest) =>
  exportItemImprovementFacts(request, ItemImprovementRecipeUpdateFact)

export const knownQuests = async (request: AppRequest): Promise<AppResult> => {
  try {
    const knownQuestKeys: QuestDocument['key'][] = await Quest.distinct('key').exec()
    return withCloudflareCache(
      request,
      ok({ quests: knownQuestKeys.map((key) => key.slice(0, 8)) }),
    )
  } catch (err) {
    captureException(err, request)
    return internalServerError()
  }
}

export const quest = async (request: AppRequest): Promise<AppResult> => {
  try {
    const info = parseReportInfo(request)
    const records = _.map(info.quests, (questItem) => ({
      ...questItem,
      key: createQuestHash(questItem),
      origin: info.origin,
    }))

    await bluebird.map(records, (questItem) => {
      return Quest.updateOne(
        {
          key: questItem.key,
          questId: questItem.questId,
          category: questItem.category,
        },
        { $setOnInsert: questItem },
        { upsert: true },
      )
    })

    return ok()
  } catch (err) {
    return handleReportError(err, request)
  }
}

export const questReward = async (request: AppRequest): Promise<AppResult> => {
  try {
    const info = parseReportInfo(request) as QuestRewardPayload
    const key = createQuestHash(info)

    await QuestReward.updateOne(
      {
        key,
        questId: info.questId,
        selections: info.selections,
        bounsCount: info.bounsCount,
      },
      { $setOnInsert: info },
      { upsert: true },
    )

    return ok()
  } catch (err) {
    return handleReportError(err, request)
  }
}
