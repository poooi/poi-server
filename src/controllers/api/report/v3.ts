import Router from '@koa/router'
import mongoose from 'mongoose'
import crypto from 'crypto'
import _ from 'lodash'
import bluebird from 'bluebird'
import { ParameterizedContext } from 'koa'

import { captureException } from '../../../sentry'
import {
  QuestPayload,
  QuestRewardPayload,
  Quest,
  QuestReward,
  QuestDocument,
} from '../../../models'

export const router = new Router()

const parseInfo = (ctx: ParameterizedContext) => {
  const info = ctx.request.body.data
  if (info.origin == null) {
    info.origin = ctx.headers['x-reporter'] || ctx.headers['user-agent']
  }
  return info
}

const createHash = _.memoize((text) => crypto.createHash('md5').update(text).digest('hex'))

const createQuestHash = ({ title, detail }: QuestPayload | QuestRewardPayload) =>
  createHash(`${title}${detail}`)

router.get('/known_quests', async (ctx, next) => {
  try {
    if (await ctx.cashed()) return // Cache control
    const knownQuests: QuestDocument['key'][] = await Quest.distinct('key').exec()
    const quests = knownQuests.map((key) => key.slice(0, 8))
    ctx.status = 200
    ctx.body = {
      quests,
    }
    await next()
  } catch (err) {
    captureException(err, ctx)
    ctx.status = 500
    await next()
  }
})

router.post('/quest', async (ctx, next) => {
  try {
    const info = parseInfo(ctx)
    const records = _.map(info.quests, (quest) => ({
      ...quest,
      key: createQuestHash(quest),
      origin: info.origin,
    }))

    await bluebird.map(records, (quest) => {
      return Quest.updateOne(
        {
          key: quest.key,
          questId: quest.questId,
          category: quest.category,
        },
        { $setOnInsert: quest },
        { upsert: true },
      )
    })

    ctx.status = 200
    await next()
  } catch (err) {
    captureException(err, ctx)
    ctx.status = 500
    await next()
  }
})

router.post('/quest_reward', async (ctx, next) => {
  try {
    const info = parseInfo(ctx)

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

    ctx.status = 200
    await next()
  } catch (err) {
    captureException(err, ctx)
    ctx.status = 500
    await next()
  }
})
