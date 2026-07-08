import mongoose from 'mongoose'
import crypto from 'crypto'
import _ from 'lodash'
import bluebird from 'bluebird'

import {
  ItemImprovementRecipeAvailabilityFact,
  ItemImprovementRecipeCostFact,
  ItemImprovementRecipeUpdateFact,
  type QuestPayload,
  type QuestRewardPayload,
  Quest,
  QuestReward,
  type QuestDocument,
} from '../../../models'
import { type AppRequest } from '../../../http/request'
import {
  ITEM_IMPROVEMENT_RECIPE_INGEST_CONCURRENCY,
  ItemImprovementRecipeValidationError,
  type ItemImprovementRecipeExportResult,
  type ItemImprovementRecipeRecord,
  createAvailabilityKey,
  createCostKey,
  createItemImprovementRecipeRecordSchema,
  createUpdateKey,
  getItemImprovementRecipeValidationErrorMessage,
  getReporterOrigin,
  isItemImprovementValidationError,
  normalizeItemImprovementRecipeRecord,
  parseExportCursor,
  parseItemImprovementRecipeData,
} from './v3.item-improvement.shared'

const createHash = _.memoize((text) => crypto.createHash('md5').update(text).digest('hex'))

const createQuestHash = ({ title, detail }: QuestPayload | QuestRewardPayload) =>
  createHash(`${title}${detail}`)

interface ExportableItemImprovementFactDocument extends mongoose.Document {
  lastReported: number
}

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
): Promise<ItemImprovementRecipeExportResult<TDocument>> => {
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

  return {
    records,
    next:
      lastRecord == null
        ? null
        : {
            updatedAfter: lastRecord.lastReported,
            afterId: lastRecord._id.toString(),
          },
  }
}

export {
  ItemImprovementRecipeValidationError,
  getItemImprovementRecipeValidationErrorMessage,
  isItemImprovementValidationError,
}

export const itemImprovementRecipe = async (request: AppRequest): Promise<number> => {
  const serverReceivedAt = Date.now()
  const origin = getReporterOrigin(request)
  const schema = createItemImprovementRecipeRecordSchema(serverReceivedAt)
  const records = parseItemImprovementRecipeData(request).map((record) =>
    normalizeItemImprovementRecipeRecord(record, schema, origin),
  )

  await bluebird.map(
    records,
    (record) => saveItemImprovementRecipeRecord(record, serverReceivedAt),
    {
      concurrency: ITEM_IMPROVEMENT_RECIPE_INGEST_CONCURRENCY,
    },
  )

  return records.length
}

export const itemImprovementRecipeAvailability = (request: AppRequest) =>
  exportItemImprovementFacts(request, ItemImprovementRecipeAvailabilityFact)

export const itemImprovementRecipeCosts = (request: AppRequest) =>
  exportItemImprovementFacts(request, ItemImprovementRecipeCostFact)

export const itemImprovementRecipeUpdates = (request: AppRequest) =>
  exportItemImprovementFacts(request, ItemImprovementRecipeUpdateFact)

export const knownQuests = async (): Promise<string[]> => {
  const knownQuestKeys: QuestDocument['key'][] = await Quest.distinct('key').exec()
  return knownQuestKeys.map((key) => key.slice(0, 8))
}

export const quest = async (info: Record<string, any>): Promise<void> => {
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
}

export const questReward = async (info: QuestRewardPayload): Promise<void> => {
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
}
