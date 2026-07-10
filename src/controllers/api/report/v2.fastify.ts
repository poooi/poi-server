import { type FastifyPluginAsync } from 'fastify'

import { sendResult, toAppRequest } from '../../../http/fastify'
import { type DatabaseBackend } from '../../../db/backend'
import * as mongoHandlers from './v2.handlers'

interface ReportRouteOptions {
  backend?: DatabaseBackend
}

export const registerReportV2Routes: FastifyPluginAsync<ReportRouteOptions> = async (
  app,
  { backend = 'mongo' },
) => {
  const handlers = backend === 'sqlite' ? await import('./v2.sqlite.handlers') : mongoHandlers
  app.post('/create_ship', async (request, reply) =>
    sendResult(reply, await handlers.createShip(toAppRequest(request))),
  )
  app.post('/create_item', async (request, reply) =>
    sendResult(reply, await handlers.createItem(toAppRequest(request))),
  )
  app.post('/remodel_item', async (request, reply) =>
    sendResult(reply, await handlers.remodelItem(toAppRequest(request))),
  )
  app.post('/drop_ship', async (request, reply) =>
    sendResult(reply, await handlers.dropShip(toAppRequest(request))),
  )
  app.post('/select_rank', async (request, reply) =>
    sendResult(reply, await handlers.selectRank(toAppRequest(request))),
  )
  app.post('/pass_event', async (request, reply) =>
    sendResult(reply, await handlers.passEvent(toAppRequest(request))),
  )
  app.get('/known_quests', async (request, reply) =>
    sendResult(reply, await handlers.knownQuests(toAppRequest(request))),
  )
  app.post('/quest/:id', async (_request, reply) => sendResult(reply, await handlers.questNoop()))
  app.post('/battle_api', async (request, reply) =>
    sendResult(reply, await handlers.battleApi(toAppRequest(request))),
  )
  app.post('/night_contcat', async (request, reply) =>
    sendResult(reply, await handlers.nightContact(toAppRequest(request))),
  )
  app.post('/aaci', async (request, reply) =>
    sendResult(reply, await handlers.aaci(toAppRequest(request))),
  )
  app.get('/known_recipes', async (_request, reply) =>
    sendResult(reply, await handlers.knownRecipes()),
  )
  app.post('/remodel_recipe', async (request, reply) =>
    sendResult(reply, await handlers.remodelRecipe(toAppRequest(request))),
  )
  app.post('/remodel_recipe_deduplicate', async (request, reply) =>
    sendResult(reply, await handlers.remodelRecipeDeduplicate(toAppRequest(request))),
  )
  app.post('/night_battle_ci', async (request, reply) =>
    sendResult(reply, await handlers.nightBattleCi(toAppRequest(request))),
  )
  app.post('/night_battle_ss_ci', async (_request, reply) =>
    sendResult(reply, await handlers.nightBattleSsCi()),
  )
  app.post('/ship_stat', async (request, reply) =>
    sendResult(reply, await handlers.shipStat(toAppRequest(request))),
  )
  app.post('/enemy_info', async (request, reply) =>
    sendResult(reply, await handlers.enemyInfo(toAppRequest(request))),
  )
}
