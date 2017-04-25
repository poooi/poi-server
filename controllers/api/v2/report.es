import Router from 'koa-router'
import mongoose from 'mongoose'
import { countBy } from 'lodash'

const router = Router()

const CreateShipRecord  = mongoose.model('CreateShipRecord')
const CreateItemRecord  = mongoose.model('CreateItemRecord')
const RemodelItemRecord = mongoose.model('RemodelItemRecord')
const DropShipRecord    = mongoose.model('DropShipRecord')
const SelectRankRecord  = mongoose.model('SelectRankRecord')
const PassEventRecord   = mongoose.model('PassEventRecord')
const Quest     = mongoose.model('Quest')
const BattleAPI = mongoose.model('BattleAPI')
const NightContactRecord  = mongoose.model('NightContactRecord')
const RecipeRecord        = mongoose.model('RecipeRecord')

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

export default (app) => {
  app.use(router.routes())
}
