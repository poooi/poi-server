import { type FastifyPluginAsync } from 'fastify'

import { sendResult, toAppRequest } from '../../../http/fastify'
import { mongoV3Actions } from './v3.mongo.actions'

export type ReportV3Actions = typeof mongoV3Actions

interface ReportV3RouteOptions {
  actions?: ReportV3Actions
}

export const registerReportV3Routes: FastifyPluginAsync<ReportV3RouteOptions> = async (
  app,
  options,
) => {
  const {
    itemImprovementRecipe,
    itemImprovementRecipeAvailability,
    itemImprovementRecipeCosts,
    itemImprovementRecipeUpdates,
    knownQuests,
    quest,
    questReward,
  } = options.actions || mongoV3Actions

  app.post('/item_improvement_recipe', async (request, reply) =>
    sendResult(reply, await itemImprovementRecipe(toAppRequest(request))),
  )
  app.get('/item_improvement_recipes/availability', async (request, reply) =>
    sendResult(reply, await itemImprovementRecipeAvailability(toAppRequest(request))),
  )
  app.get('/item_improvement_recipes/costs', async (request, reply) =>
    sendResult(reply, await itemImprovementRecipeCosts(toAppRequest(request))),
  )
  app.get('/item_improvement_recipes/updates', async (request, reply) =>
    sendResult(reply, await itemImprovementRecipeUpdates(toAppRequest(request))),
  )
  app.get('/known_quests', async (request, reply) =>
    sendResult(reply, await knownQuests(toAppRequest(request))),
  )
  app.post('/quest', async (request, reply) =>
    sendResult(reply, await quest(toAppRequest(request))),
  )
  app.post('/quest_reward', async (request, reply) =>
    sendResult(reply, await questReward(toAppRequest(request))),
  )
}
