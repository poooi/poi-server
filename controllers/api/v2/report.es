import Router from 'koa-router'
import mongoose from 'mongoose'
import { countBy } from 'lodash'
import semver from 'semver'

const router = Router()

const CreateShipRecord   = mongoose.model('CreateShipRecord')
const CreateItemRecord   = mongoose.model('CreateItemRecord')
const RemodelItemRecord  = mongoose.model('RemodelItemRecord')
const DropShipRecord     = mongoose.model('DropShipRecord')
const SelectRankRecord   = mongoose.model('SelectRankRecord')
const PassEventRecord    = mongoose.model('PassEventRecord')
const Quest              = mongoose.model('Quest')
const BattleAPI          = mongoose.model('BattleAPI')
const NightContactRecord = mongoose.model('NightContactRecord')
const AACIRecord         = mongoose.model('AACIRecord')
const RecipeRecord       = mongoose.model('RecipeRecord')
const NightBattleCI      = mongoose.model('NightBattleCI')
const ShipStat           = mongoose.model('ShipStat')
const EnemyInfo          = mongoose.model('EnemyInfo')

function parseInfo(ctx) {
  const info = JSON.parse(ctx.request.body.data)
  if (info.origin == null)
    info.origin = ctx.headers['user-agent']
  return info
}

router.post('/api/report/v2/create_ship', async (ctx, next) => {
  try {
    const info = parseInfo(ctx)
    const record = new CreateShipRecord(info)
    await record.saveAsync()
    ctx.status = 200
    await next()
  }
  catch (err) {
    ctx.status = 500
    await next()
  }
})

router.post('/api/report/v2/create_item', async (ctx, next) => {
  try {
    const info = parseInfo(ctx)
    const record = new CreateItemRecord(info)
    await record.saveAsync()
    ctx.status = 200
    await next()
  }
  catch (err) {
    ctx.status = 500
    await next()
  }
})

router.post('/api/report/v2/remodel_item', async (ctx, next) => {
  try {
    const info = parseInfo(ctx)
    const record = new RemodelItemRecord(info)
    await record.saveAsync()
    ctx.status = 200
    await next()
  }
  catch (err) {
    ctx.status = 500
    await next()
  }
})

router.post('/api/report/v2/drop_ship', async (ctx, next) => {
  try {
    const info = parseInfo(ctx)
    const record = new DropShipRecord(info)
    await record.saveAsync()
    ctx.status = 200
    await next()
  }
  catch (err) {
    ctx.status = 500
    await next()
  }
})

router.post('/api/report/v2/select_rank', async (ctx, next) => {
  try {
    const info = parseInfo(ctx)
    let record = await SelectRankRecord.findOne({
      teitokuId: info.teitokuId,
      mapareaId: info.mapareaId,
    }).execAsync()
    if (record != null) {
      record.teitokuLv = info.teitokuLv
      record.rank = info.rank
      record.origin = info.origin
    } else {
      record = new SelectRankRecord(info)
    }
    await record.saveAsync()
    ctx.status = 200
    await next()
  }
  catch (err) {
    ctx.status = 500
    await next()
  }
})

router.post('/api/report/v2/pass_event', async (ctx, next) => {
  try {
    const info = parseInfo(ctx)
    const record = new PassEventRecord(info)
    await record.saveAsync()
    ctx.status = 200
    await next()
  }
  catch (err) {
    ctx.status = 500
    await next()
  }
})

// Use knownQuests to cache current known quests state.
router.get('/api/report/v2/known_quests', async (ctx, next) => {
  try {
    if (await ctx.cashed()) return  // Cache control
    const knownQuests = await Quest.find().distinct('questId').execAsync()
    knownQuests.sort()
    ctx.status = 200
    ctx.body   = {
      quests: knownQuests,
    }
    await next()
  }
  catch (err) {
    ctx.status = 500
    await next()
  }
})

router.post('/api/report/v2/quest/:id', async (ctx, next) => {
  try {
    const info = parseInfo(ctx)
    const record = new Quest(info)
    await record.saveAsync()
    ctx.status = 200
    await next()
  }
  catch (err) {
    ctx.status = 500
    await next()
  }
})

router.post('/api/report/v2/battle_api', async (ctx, next) => {
  try {
    const info = parseInfo(ctx)
    const record = new BattleAPI(info)
    await record.saveAsync()
    ctx.status = 200
    await next()
  }
  catch (err) {
    ctx.status = 500
    await next()
  }
})

router.post('/api/report/v2/night_contcat', async (ctx, next) => {
  try {
    const info = parseInfo(ctx)
    const record = new NightContactRecord(info)
    await record.saveAsync()
    ctx.status = 200
    await next()
  }
  catch (err) {
    ctx.status = 500
    await next()
  }
})

router.post('/api/report/v2/aaci', async (ctx, next) => {
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
      await record.saveAsync()
    }
    ctx.status = 200
    await next()
  }
  catch (err) {
    ctx.status = 500
    await next()
  }
})

router.get('/api/report/v2/known_recipes', async (ctx, next) => {
  try {
    if (await ctx.cashed()) return  // Cache control
    const allRecipes = await RecipeRecord.find().execAsync()
    const counts = countBy(allRecipes, 'key')
    const knownRecipes = Object.keys(counts).filter(key => counts[key] > 3)
    ctx.status = 200
    ctx.body   = {
      recipes: knownRecipes,
    }
    await next()
  }
  catch (err) {
    ctx.status = 500
    await next()
  }
})

router.post('/api/report/v2/remodel_recipe', async (ctx, next) => {
  try {
    const info = parseInfo(ctx)
    if (info.stage != -1) {
      const record = new RecipeRecord(info)
      await record.saveAsync()
    }
    ctx.status = 200
    await next()
  }
  catch (err) {
    ctx.status = 500
    await next()
  }
})

router.post('/api/report/v2/night_battle_ci', async (ctx, next) => {
  try {
    const info = parseInfo(ctx)
    const record = new NightBattleCI(info)
    await record.saveAsync()
    ctx.status = 200
    await next()
  }
  catch (err) {
    ctx.status = 500
    await next()
  }
})

// Compat for legacy plugin's night battle ss ci reporter
// which is now night battle ci reporter and has changed url to above
router.post('/api/report/v2/night_battle_ss_ci', async (ctx, next) => {
  ctx.status = 200
  await next()
})

router.post('/api/report/v2/ship_stat', async (ctx, next) => {
  try {
    const { id, lv, los, los_max, asw, asw_max, evasion, evasion_max } = parseInfo(ctx)
    const last_timestamp = +new Date()
    await ShipStat.updateAsync({
      id, lv, los, los_max, asw, asw_max, evasion, evasion_max,
    }, {
      id, lv, los, los_max, asw, asw_max, evasion, evasion_max, last_timestamp, $inc: { count: 1 },
    }, {
      upsert: true,
    })
    ctx.status = 200
    await next()
  } catch (e) {
    ctx.status = 500
    await next()
  }
})

router.post('/api/report/v2/enemy_info', async (ctx, next) => {
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
    await EnemyInfo.updateAsync({
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
    }, {
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
    }, {
      upsert: true,
    })
    ctx.status = 200
    await next()
  } catch (e) {
    ctx.status = 500
    await next()
  }
})

export default (app) => {
  app.use(router.routes())
}
