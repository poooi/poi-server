import mongoose from 'mongoose'
import semver from 'semver'
import { flatMap, drop } from 'lodash'

import { withCloudflareCache } from '../../../http/cache-control'
import { type AppRequest } from '../../../http/request'
import { internalServerError, ok, type AppResult } from '../../../http/result'
import { captureException } from '../../../sentry'
import { DropShipRecord, SelectRankRecord } from '../../../models'
import { handleReportError, parseReportInfo } from './shared'

const CreateShipRecord = mongoose.model('CreateShipRecord')
const CreateItemRecord = mongoose.model('CreateItemRecord')
const RemodelItemRecord = mongoose.model('RemodelItemRecord')
const PassEventRecord = mongoose.model('PassEventRecord')
const Quest = mongoose.model('Quest')
const BattleAPI = mongoose.model('BattleAPI')
const NightContactRecord = mongoose.model('NightContactRecord')
const AACIRecord = mongoose.model('AACIRecord')
const RecipeRecord = mongoose.model('RecipeRecord')
const NightBattleCI = mongoose.model('NightBattleCI')
const ShipStat = mongoose.model('ShipStat')
const EnemyInfo = mongoose.model('EnemyInfo')

const saveReportRecord = async (
  request: AppRequest,
  createRecord: (info: Record<string, any>) => { save: () => Promise<unknown> },
): Promise<AppResult> => {
  try {
    const info = parseReportInfo(request)
    await createRecord(info).save()
    return ok()
  } catch (err) {
    return handleReportError(err, request)
  }
}

export const createShip = (request: AppRequest) =>
  saveReportRecord(request, (info) => new CreateShipRecord(info))

export const createItem = (request: AppRequest) =>
  saveReportRecord(request, (info) => new CreateItemRecord(info))

export const remodelItem = (request: AppRequest) =>
  saveReportRecord(request, (info) => new RemodelItemRecord(info))

export const dropShip = async (request: AppRequest): Promise<AppResult> => {
  try {
    const info = parseReportInfo(request)
    const record = new DropShipRecord(info)
    if (record.mapId < 73) {
      record.ownedShipSnapshot = {}
    }
    await record.save()
    return ok()
  } catch (err) {
    return handleReportError(err, request)
  }
}

export const selectRank = async (request: AppRequest): Promise<AppResult> => {
  try {
    const info = parseReportInfo(request)
    let record = await SelectRankRecord.findOne({
      teitokuId: info.teitokuId,
      mapareaId: info.mapareaId,
    }).exec()
    if (record != null) {
      record.teitokuLv = info.teitokuLv
      record.rank = info.rank
      record.origin = info.origin
    } else {
      record = new SelectRankRecord(info)
    }
    await record.save()
    return ok()
  } catch (err) {
    return handleReportError(err, request)
  }
}

export const passEvent = (request: AppRequest) =>
  saveReportRecord(request, (info) => new PassEventRecord(info))

export const knownQuests = async (request: AppRequest): Promise<AppResult> => {
  try {
    const knownQuestIds = await Quest.find().distinct('questId').exec()
    knownQuestIds.sort()
    return withCloudflareCache(request, ok({ quests: knownQuestIds }))
  } catch (err) {
    captureException(err, request)
    return internalServerError()
  }
}

export const questNoop = async (): Promise<AppResult> => ok()

export const battleApi = (request: AppRequest) =>
  saveReportRecord(request, (info) => new BattleAPI(info))

export const nightContact = (request: AppRequest) =>
  saveReportRecord(request, (info) => new NightContactRecord(info))

export const aaci = async (request: AppRequest): Promise<AppResult> => {
  try {
    const info = parseReportInfo(request)
    if (
      semver.gt(info.poiVersion, '7.9.1') &&
      info.origin.startsWith('Reporter ') &&
      semver.gte(info.origin.replace('Reporter ', ''), '3.6.0')
    ) {
      const record = new AACIRecord(info)
      await record.save()
    }
    return ok()
  } catch (err) {
    return handleReportError(err, request)
  }
}

export const knownRecipes = async (): Promise<AppResult> => ok({ recipes: [] })

export const remodelRecipe = async (request: AppRequest): Promise<AppResult> => {
  try {
    const info = parseReportInfo(request)
    if (info.stage != -1) {
      const lastReported = +new Date()
      const { recipeId, itemId, stage, day, secretary } = info

      await RecipeRecord.updateOne(
        { recipeId, itemId, stage, day, secretary },
        { ...info, lastReported, $inc: { count: 1 } },
        { upsert: true },
      )
    }
    return ok()
  } catch (err) {
    return handleReportError(err, request)
  }
}

export const remodelRecipeDeduplicate = async (request: AppRequest): Promise<AppResult> => {
  try {
    const duplicates = await RecipeRecord.aggregate([
      { $group: { _id: '$key', count: { $sum: 1 }, records: { $addToSet: '$_id' } } },
      { $match: { _id: { $ne: null }, count: { $gt: 1 } } },
    ]).exec()

    const recordsToDelete = flatMap(duplicates, (item) => drop(item.records, 1))

    await RecipeRecord.deleteMany({ _id: { $in: recordsToDelete } })

    return ok({ recipes: recordsToDelete })
  } catch (err) {
    captureException(err, request)
    return internalServerError()
  }
}

export const nightBattleCi = (request: AppRequest) =>
  saveReportRecord(request, (info) => new NightBattleCI(info))

export const nightBattleSsCi = async (): Promise<AppResult> => ok()

export const shipStat = async (request: AppRequest): Promise<AppResult> => {
  try {
    const { id, lv, los, los_max, asw, asw_max, evasion, evasion_max } = parseReportInfo(request)
    const last_timestamp = +new Date()
    await ShipStat.updateOne(
      {
        id,
        lv,
        los,
        los_max,
        asw,
        asw_max,
        evasion,
        evasion_max,
      },
      {
        id,
        lv,
        los,
        los_max,
        asw,
        asw_max,
        evasion,
        evasion_max,
        last_timestamp,
        $inc: { count: 1 },
      },
      {
        upsert: true,
      },
    )
    return ok()
  } catch (err) {
    return handleReportError(err, request)
  }
}

export const enemyInfo = async (request: AppRequest): Promise<AppResult> => {
  try {
    const info = parseReportInfo(request)
    const {
      ships1,
      levels1,
      hp1,
      stats1,
      equips1,
      ships2,
      levels2,
      hp2,
      stats2,
      equips2,
      planes,
      bombersMin,
      bombersMax,
    } = info
    await EnemyInfo.updateOne(
      {
        ships1,
        levels1,
        hp1,
        stats1,
        equips1,
        ships2,
        levels2,
        hp2,
        stats2,
        equips2,
        planes,
      },
      {
        ships1,
        levels1,
        hp1,
        stats1,
        equips1,
        ships2,
        levels2,
        hp2,
        stats2,
        equips2,
        planes,
        $min: { bombersMax },
        $max: { bombersMin },
        $inc: { count: 1 },
      },
      {
        upsert: true,
      },
    )
    return ok()
  } catch (err) {
    return handleReportError(err, request)
  }
}
