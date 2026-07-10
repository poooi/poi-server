import { type FastifyPluginAsync } from 'fastify'

import { sendResult, toAppRequest } from '../../../http/fastify'
import { type DatabaseBackend } from '../../../db/backend'
import * as mongoHandlers from './v3.handlers'

interface ReportRouteOptions {
  backend?: DatabaseBackend
}

export const registerReportV3Routes: FastifyPluginAsync<ReportRouteOptions> = async (
  app,
  { backend = 'mongo' },
) => {
  const handlers = backend === 'sqlite' ? await import('./v3.sqlite.handlers') : mongoHandlers
  app.post('/item_improvement_recipe', async (request, reply) =>
    sendResult(reply, await handlers.itemImprovementRecipe(toAppRequest(request))),
  )
  app.get('/item_improvement_recipes/availability', async (request, reply) =>
    sendResult(reply, await handlers.itemImprovementRecipeAvailability(toAppRequest(request))),
  )
  app.get('/item_improvement_recipes/costs', async (request, reply) =>
    sendResult(reply, await handlers.itemImprovementRecipeCosts(toAppRequest(request))),
  )
  app.get('/item_improvement_recipes/updates', async (request, reply) =>
    sendResult(reply, await handlers.itemImprovementRecipeUpdates(toAppRequest(request))),
  )
  app.get('/known_quests', async (request, reply) =>
    sendResult(reply, await handlers.knownQuests(toAppRequest(request))),
  )
  app.post('/quest', async (request, reply) =>
    sendResult(reply, await handlers.quest(toAppRequest(request))),
  )
  app.post('/quest_reward', async (request, reply) =>
    sendResult(reply, await handlers.questReward(toAppRequest(request))),
  )
}
