import { type FastifyPluginAsync } from 'fastify'

import { sendResult, toAppRequest } from '../../../http/fastify'
import {
  itemImprovementRecipe,
  itemImprovementRecipeAvailability,
  itemImprovementRecipeCosts,
  itemImprovementRecipeUpdates,
  knownQuests,
  quest,
  questReward,
} from './v3.handlers'

export const registerReportV3Routes: FastifyPluginAsync = async (app) => {
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
