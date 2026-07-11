import mongoose from 'mongoose'
import bluebird from 'bluebird'
import { ZodError } from 'zod'

import { withCloudflareCache } from '../../../http/cache-control'
import { legacyMongoEpoch } from '../../../contracts/database'
import {
  createAvailabilityKey,
  createCostKey,
  createUpdateKey,
  createItemImprovementRecipeRecordSchema,
  getItemImprovementRecipeValidationErrorMessage,
  getReporterOrigin,
  isItemImprovementValidationError,
  normalizeItemImprovementRecipeRecord,
  parseExportCursor,
  parseItemImprovementRecipeData,
  type ItemImprovementRecipeRecord,
} from '../../../contracts/item-improvement-recipe'
import { logReportValidationIssues } from '../../../contracts/report-validation'
import {
  createQuestHash,
  normalizeQuestReport,
  normalizeQuestRewardReport,
} from '../../../contracts/v3-report'
import { type AppRequest } from '../../../http/request'
import { badRequest, internalServerError, ok, type AppResult } from '../../../http/result'
import { captureException } from '../../../sentry'
import {
  ItemImprovementRecipeAvailabilityFact,
  ItemImprovementRecipeCostFact,
  ItemImprovementRecipeUpdateFact,
  Quest,
  QuestReward,
  type QuestDocument,
} from '../../../models'
import { getRequestData, handleReportError, parseReportInfo } from './shared'

interface ExportableItemImprovementFactDocument extends mongoose.Document {
  lastReported: number
}

// MongoDB uses an unbounded application-level concurrency limit for ingest writes; PostgreSQL
// deliberately uses a lower pool-aware concurrency (see v3.postgres.actions.ts). Validation,
// normalization, and key generation are shared via ../../../contracts/item-improvement-recipe so
// both backends persist identical Domain Identities and record shapes.
const ITEM_IMPROVEMENT_RECIPE_INGEST_CONCURRENCY = 10

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
      logReportValidationIssues(
        request,
        err instanceof ZodError ? err.issues : [{ message: err.message }],
        request.query,
      )
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
    const records = parseItemImprovementRecipeData(getRequestData(request.body)).map((record) =>
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
      logReportValidationIssues(
        request,
        err instanceof ZodError ? err.issues : [{ message: err.message }],
        getRequestData(request.body),
      )
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
    const info = normalizeQuestReport(parseReportInfo(request), request)
    const records = info.quests.map((questItem) => ({
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
    const info = normalizeQuestRewardReport(parseReportInfo(request), request)
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

export const mongoV3Actions = {
  itemImprovementRecipe,
  itemImprovementRecipeAvailability,
  itemImprovementRecipeCosts,
  itemImprovementRecipeUpdates,
  knownQuests,
  quest,
  questReward,
}
