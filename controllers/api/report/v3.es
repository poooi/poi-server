import Router from '@koa/router'
import mongoose from 'mongoose'
import crypto from 'crypto'
import _ from 'lodash'
import bluebird from 'bluebird'

import { captureException } from '../../../sentry'

export const router = new Router()

const Quest = mongoose.model('Quest')

const parseInfo = (ctx) => {
  const info = ctx.request.body.data
  if (info.origin == null) {
    info.origin = ctx.headers['x-reporter'] || ctx.headers['user-agent']
  }
  return info
}

const createHash = text => crypto.createHash('md5').update(text).digest('hex')

const createQuestHash = ({ title, detail }) => createHash(`${title}${detail}`)

router.get('/known_quests', async (ctx, next) => {
  try {
    if (await ctx.cashed()) return  // Cache control
    const knownQuests = await Quest.distinct('key').exec()
    const quests = knownQuests.map(key => key.slice(0, 8))
    ctx.status = 200
    ctx.body   = {
      quests,
    }
    await next()
  }
  catch (err) {
    captureException(err, ctx)
    ctx.status = 500
    await next()
  }
})

router.post('/quest', async (ctx, next) => {
  try {
    const info = parseInfo(ctx)
    const records = _.map(info.quests, quest => ({
      ...quest,
      key: createQuestHash(quest),
      origin: info.origin,
    }))

    await bluebird.map(records, (quest) => {
      return Quest.updateOne({
        key: quest.key,
      }, quest, { upsert: true })
    })

    ctx.status = 200
    await next()
  }
  catch (err) {
    captureException(err, ctx)
    ctx.status = 500
    await next()
  }
})


router.post('/quest_normalize', async (ctx, next) => {
  const quests = await Quest.find({ key: { $eq: null } }).exec()
  await bluebird.map(quests, quest => Quest.updateOne(quest, { key: createQuestHash(quest) }))
  ctx.status = 200
  ctx.body = {
    quests,
  }
  await next()
})
