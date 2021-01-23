import Router from '@koa/router'
import mongoose from 'mongoose'
import semver from 'semver'
import { captureException } from '../../../sentry'
import { isString, flatMap, drop } from 'lodash'

export const router = new Router()

const CreateShipRecord = mongoose.model('CreateShipRecord')
const CreateItemRecord = mongoose.model('CreateItemRecord')
const RemodelItemRecord = mongoose.model('RemodelItemRecord')
const DropShipRecord = mongoose.model('DropShipRecord')
const SelectRankRecord = mongoose.model('SelectRankRecord')
const PassEventRecord = mongoose.model('PassEventRecord')
const Quest = mongoose.model('Quest')
const BattleAPI = mongoose.model('BattleAPI')
const NightContactRecord = mongoose.model('NightContactRecord')
const AACIRecord = mongoose.model('AACIRecord')
const RecipeRecord = mongoose.model('RecipeRecord')
const NightBattleCI = mongoose.model('NightBattleCI')
const ShipStat = mongoose.model('ShipStat')
const EnemyInfo = mongoose.model('EnemyInfo')

function parseInfo(ctx) {
  const info = isString(ctx.request.body.data)
    ? JSON.parse(ctx.request.body.data)
    : ctx.request.body.data
  if (info.origin == null) {
    info.origin = ctx.headers['x-reporter'] || ctx.headers['user-agent']
  }
  return info
}

router.post('/create_ship', async (ctx, next) => {
  try {
    const info = parseInfo(ctx)
    const record = new CreateShipRecord(info)
    await record.save()
    ctx.status = 200
    await next()
  } catch (err) {
    captureException(err, ctx)
    ctx.status = 500
    await next()
  }
})

router.post('/create_item', async (ctx, next) => {
  try {
    const info = parseInfo(ctx)
    const record = new CreateItemRecord(info)
    await record.save()
    ctx.status = 200
    await next()
  } catch (err) {
    captureException(err, ctx)
    ctx.status = 500
    await next()
  }
})

router.post('/remodel_item', async (ctx, next) => {
  try {
    const info = parseInfo(ctx)
    const record = new RemodelItemRecord(info)
    await record.save()
    ctx.status = 200
    await next()
  } catch (err) {
    captureException(err, ctx)
    ctx.status = 500
    await next()
  }
})

router.post('/drop_ship', async (ctx, next) => {
  try {
    const info = parseInfo(ctx)
    const record = new DropShipRecord(info)
    await record.save()
    ctx.status = 200
    await next()
  } catch (err) {
    captureException(err, ctx)
    ctx.status = 500
    await next()
  }
})

router.post('/select_rank', async (ctx, next) => {
  try {
    const info = parseInfo(ctx)
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
    ctx.status = 200
    await next()
  } catch (err) {
    captureException(err, ctx)
    ctx.status = 500
    await next()
  }
})

router.post('/pass_event', async (ctx, next) => {
  try {
    const info = parseInfo(ctx)
    const record = new PassEventRecord(info)
    await record.save()
    ctx.status = 200
    await next()
  } catch (err) {
    captureException(err, ctx)
    ctx.status = 500
    await next()
  }
})

// Use knownQuests to cache current known quests state.
router.get('/known_quests', async (ctx, next) => {
  try {
    if (await ctx.cashed()) return // Cache control
    const knownQuests = await Quest.find().distinct('questId').exec()
    knownQuests.sort()
    ctx.status = 200
    ctx.body = {
      quests: knownQuests,
    }
    await next()
  } catch (err) {
    captureException(err, ctx)
    ctx.status = 500
    await next()
  }
})

router.post('/quest/:id', async (ctx, next) => {
  ctx.status = 200
  await next()
})

router.post('/battle_api', async (ctx, next) => {
  try {
    const info = parseInfo(ctx)
    const record = new BattleAPI(info)
    await record.save()
    ctx.status = 200
    await next()
  } catch (err) {
    captureException(err, ctx)
    ctx.status = 500
    await next()
  }
})

router.post('/night_contcat', async (ctx, next) => {
  try {
    const info = parseInfo(ctx)
    const record = new NightContactRecord(info)
    await record.save()
    ctx.status = 200
    await next()
  } catch (err) {
    captureException(err, ctx)
    ctx.status = 500
    await next()
  }
})

router.post('/aaci', async (ctx, next) => {
  try {
    const info = parseInfo(ctx)
    // aaci type 7 in poi <= 7.9.0 is not correctly detected
    // reporter < 3.6.0 cannot send untriggered aaci report
    // so we add a semver check
    if (
      semver.gt(info.poiVersion, '7.9.1') &&
      info.origin.startsWith('Reporter ') &&
      semver.gte(info.origin.replace('Reporter ', ''), '3.6.0')
    ) {
      const record = new AACIRecord(info)
      await record.save()
    }
    ctx.status = 200
    await next()
  } catch (err) {
    captureException(err, ctx)
    ctx.status = 500
    await next()
  }
})

// FIXME: this action is no longer in use, keeping it until changes made in reporter
router.get('/known_recipes', async (ctx, next) => {
  try {
    ctx.status = 200
    ctx.body = {
      recipes: [],
    }
    await next()
  } catch (err) {
    captureException(err, ctx)
    ctx.status = 500
    await next()
  }
})

router.post('/remodel_recipe', async (ctx, next) => {
  try {
    const info = parseInfo(ctx)
    if (info.stage != -1) {
      const lastReported = +new Date()
      const { recipeId, itemId, stage, day, secretary } = info

      await RecipeRecord.updateOne(
        { recipeId, itemId, stage, day, secretary },
        { ...info, lastReported, $inc: { count: 1 } },
        { upsert: true },
      )
    }
    ctx.status = 200
    await next()
  } catch (err) {
    captureException(err, ctx)
    ctx.status = 500
    await next()
  }
})

router.post('/remodel_recipe_deduplicate', async (ctx, next) => {
  try {
    const duplicates = await RecipeRecord.aggregate([
      { $group: { _id: '$key', count: { $sum: 1 }, records: { $addToSet: '$_id' } } },
      { $match: { _id: { $ne: null }, count: { $gt: 1 } } },
    ]).exec()

    const recordsToDelete = flatMap(duplicates, (item) => drop(item.records, 1))

    await RecipeRecord.deleteMany({ _id: { $in: recordsToDelete } })

    ctx.status = 200
    ctx.body = {
      recipes: recordsToDelete,
    }
    await next()
  } catch (err) {
    captureException(err, ctx)
    ctx.status = 500
    await next()
  }
})

router.post('/night_battle_ci', async (ctx, next) => {
  try {
    const info = parseInfo(ctx)
    const record = new NightBattleCI(info)
    await record.save()
    ctx.status = 200
    await next()
  } catch (err) {
    captureException(err, ctx)
    ctx.status = 500
    await next()
  }
})

// Compat for legacy plugin's night battle ss ci reporter
// which is now night battle ci reporter and has changed url to above
router.post('/night_battle_ss_ci', async (ctx, next) => {
  ctx.status = 200
  await next()
})

router.post('/ship_stat', async (ctx, next) => {
  try {
    const { id, lv, los, los_max, asw, asw_max, evasion, evasion_max } = parseInfo(ctx)
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
    ctx.status = 200
    await next()
  } catch (err) {
    captureException(err, ctx)
    ctx.status = 500
    await next()
  }
})

router.post('/enemy_info', async (ctx, next) => {
  try {
    const info = parseInfo(ctx)
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
    ctx.status = 200
    await next()
  } catch (err) {
    captureException(err, ctx)
    ctx.status = 500
    await next()
  }
})
