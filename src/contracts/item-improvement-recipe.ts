import { isString } from 'lodash'
import { z, ZodError } from 'zod'

import { getHeader, type AppRequest } from '../http/request'
import { type RequiredItem } from '../models'
import { canonicalizeObjectIdCursor } from './item-improvement'

// Backend-neutral v3 item-improvement-recipe contract: validation, normalization, and
// deterministic key generation shared by the MongoDB and PostgreSQL action sets so both
// backends persist/export byte-for-byte identical Domain Identities and payload shapes.
// Backend-specific write/export mechanics (Mongoose update operators vs. Drizzle
// insert/onConflict, ingest concurrency, transport-level storage) stay in each backend's own
// `v3.<backend>.actions.ts` module.

export const ITEM_IMPROVEMENT_RECIPE_MAX_EXPORT_LIMIT = 1000
export const ITEM_IMPROVEMENT_RECIPE_DEFAULT_EXPORT_LIMIT = 500
export const ITEM_IMPROVEMENT_RECIPE_MAX_INGEST_BATCH_SIZE = 100
const ITEM_IMPROVEMENT_RECIPE_JST_MIDNIGHT_TOLERANCE = 15 * 60 * 1000
const ITEM_IMPROVEMENT_RECIPE_MIN_TIMESTAMP = Date.UTC(2013, 3, 23)
const ITEM_IMPROVEMENT_RECIPE_MAX_FUTURE_SKEW = 10 * 60 * 1000
const REPORTER_ORIGIN_PATTERN = /^[A-Za-z][A-Za-z0-9 _./+-]{0,79}$/

export type ItemImprovementRecipeSource = 'list' | 'detail' | 'execution'

export interface ItemImprovementRecipeBaseRecord {
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

export interface ItemImprovementRecipeListRecord extends ItemImprovementRecipeBaseRecord {
  source: 'list'
}

export interface ItemImprovementRecipeDetailRecord extends ItemImprovementRecipeBaseRecord {
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

export interface ItemImprovementRecipeExecutionRecord extends ItemImprovementRecipeBaseRecord {
  source: 'execution'
  itemLevel: number
  upgradeObserved: true
  upgradeToItemId: number
  upgradeToItemLevel: number
}

export type ItemImprovementRecipeRecord =
  | ItemImprovementRecipeListRecord
  | ItemImprovementRecipeDetailRecord
  | ItemImprovementRecipeExecutionRecord

export class ItemImprovementRecipeValidationError extends Error {}

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

const numericIntegerSchema = z
  .union([z.number(), z.string().regex(/^-?\d+$/), z.boolean()])
  .transform(Number)
  .refine(Number.isInteger, { message: 'must be an integer' })

const integerSchema = numericIntegerSchema.refine(
  (value) => value >= -2147483648 && value <= 2147483647,
  { message: 'must be a signed 32-bit integer' },
)

const safeIntegerSchema = numericIntegerSchema.refine(
  (value) => Number.isSafeInteger(value) && value >= 0,
  { message: 'must be a non-negative safe integer' },
)

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
  safeIntegerSchema.refine(
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

export const createItemImprovementRecipeRecordSchema = (serverReceivedAt: number) => {
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

export const itemImprovementRecipeDataSchema = z
  .object({
    records: z.array(z.unknown()).max(ITEM_IMPROVEMENT_RECIPE_MAX_INGEST_BATCH_SIZE).optional(),
  })
  .catchall(z.unknown())

export interface ExportCursor {
  updatedAfter: number
  afterId?: string
  limit: number
}

const exportCursorSchema = z
  .object({
    updatedAfter: safeIntegerSchema.optional().default(0),
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
  .transform((cursor): ExportCursor => ({
    ...cursor,
    afterId: cursor.afterId == null ? undefined : canonicalizeObjectIdCursor(cursor.afterId),
    limit: Math.min(cursor.limit, ITEM_IMPROVEMENT_RECIPE_MAX_EXPORT_LIMIT),
  }))

export const parseExportCursor = (request: AppRequest): ExportCursor =>
  exportCursorSchema.parse({
    updatedAfter: request.query.updatedAfter,
    afterId: request.query.afterId,
    limit: request.query.limit,
  })

export const getItemImprovementRecipeValidationErrorMessage = (
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

export const isItemImprovementValidationError = (
  err: unknown,
): err is ItemImprovementRecipeValidationError | ZodError =>
  err instanceof ItemImprovementRecipeValidationError || err instanceof ZodError

export const getReporterOrigin = (request: AppRequest): string | undefined => {
  const origin = getHeader(request, 'x-reporter').trim()
  return REPORTER_ORIGIN_PATTERN.test(origin) ? origin : undefined
}

const parseJsonData = (data: unknown) => {
  if (!isString(data)) {
    return data
  }
  try {
    return JSON.parse(data)
  } catch {
    throw new ItemImprovementRecipeValidationError('data must be valid JSON')
  }
}

export const parseItemImprovementRecipeData = (rawData: unknown): unknown[] => {
  const parsedData = itemImprovementRecipeDataSchema.parse(parseJsonData(rawData))
  if (parsedData.records != null) {
    return parsedData.records
  }
  return [parsedData]
}

export const normalizeItemImprovementRecipeRecord = (
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

export const createAvailabilityKey = (record: ItemImprovementRecipeListRecord): string =>
  [
    'v1',
    'availability',
    record.recipeId,
    record.itemId,
    record.day,
    record.observedSecondShipId,
  ].join('|')

export const createCostKey = (record: ItemImprovementRecipeDetailRecord): string =>
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

export const createUpdateKey = (record: ItemImprovementRecipeExecutionRecord): string =>
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
