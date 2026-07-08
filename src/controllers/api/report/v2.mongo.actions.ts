import mongoose from 'mongoose'
import semver from 'semver'
import { flatMap, drop } from 'lodash'

import { DropShipRecord, SelectRankRecord } from '../../../models'

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

type ReportInfo = Record<string, any>

const saveModelRecord = async (
  info: ReportInfo,
  createRecord: (payload: ReportInfo) => { save: () => Promise<unknown> },
): Promise<void> => {
  await createRecord(info).save()
}

export const createShip = (info: ReportInfo) =>
  saveModelRecord(info, (payload) => new CreateShipRecord(payload))

export const createItem = (info: ReportInfo) =>
  saveModelRecord(info, (payload) => new CreateItemRecord(payload))

export const remodelItem = (info: ReportInfo) =>
  saveModelRecord(info, (payload) => new RemodelItemRecord(payload))

export const dropShip = async (info: ReportInfo): Promise<void> => {
  const record = new DropShipRecord(info)
  if (record.mapId < 73) {
    record.ownedShipSnapshot = {}
  }
  await record.save()
}

export const selectRank = async (info: ReportInfo): Promise<void> => {
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
}

export const passEvent = (info: ReportInfo) =>
  saveModelRecord(info, (payload) => new PassEventRecord(payload))

export const knownQuests = async (): Promise<number[]> => {
  const knownQuestIds = await Quest.find().distinct('questId').exec()
  knownQuestIds.sort()
  return knownQuestIds
}

export const questNoop = async (): Promise<void> => {}

export const battleApi = (info: ReportInfo) =>
  saveModelRecord(info, (payload) => new BattleAPI(payload))

export const nightContact = (info: ReportInfo) =>
  saveModelRecord(info, (payload) => new NightContactRecord(payload))

export const aaci = async (info: ReportInfo): Promise<void> => {
  if (
    semver.gt(info.poiVersion, '7.9.1') &&
    info.origin.startsWith('Reporter ') &&
    semver.gte(info.origin.replace('Reporter ', ''), '3.6.0')
  ) {
    const record = new AACIRecord(info)
    await record.save()
  }
}

export const knownRecipes = async (): Promise<never[]> => []

export const remodelRecipe = async (info: ReportInfo): Promise<void> => {
  if (info.stage != -1) {
    const lastReported = +new Date()
    const { recipeId, itemId, stage, day, secretary } = info

    await RecipeRecord.updateOne(
      { recipeId, itemId, stage, day, secretary },
      { ...info, lastReported, $inc: { count: 1 } },
      { upsert: true },
    )
  }
}

export const remodelRecipeDeduplicate = async (): Promise<unknown[]> => {
  const duplicates = await RecipeRecord.aggregate([
    { $group: { _id: '$key', count: { $sum: 1 }, records: { $addToSet: '$_id' } } },
    { $match: { _id: { $ne: null }, count: { $gt: 1 } } },
  ]).exec()

  const recordsToDelete = flatMap(duplicates, (item) => drop(item.records, 1))

  await RecipeRecord.deleteMany({ _id: { $in: recordsToDelete } })

  return recordsToDelete
}

export const nightBattleCi = (info: ReportInfo) =>
  saveModelRecord(info, (payload) => new NightBattleCI(payload))

export const nightBattleSsCi = async (): Promise<void> => {}

export const shipStat = async (info: ReportInfo): Promise<void> => {
  const { id, lv, los, los_max, asw, asw_max, evasion, evasion_max } = info
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
}

export const enemyInfo = async (info: ReportInfo): Promise<void> => {
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
}
