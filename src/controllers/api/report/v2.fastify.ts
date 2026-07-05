import { type FastifyPluginAsync } from 'fastify'

import { sendResult, toAppRequest } from '../../../http/fastify'
import {
  aaci,
  battleApi,
  createItem,
  createShip,
  dropShip,
  enemyInfo,
  knownQuests,
  knownRecipes,
  nightBattleCi,
  nightBattleSsCi,
  nightContact,
  passEvent,
  questNoop,
  remodelItem,
  remodelRecipe,
  remodelRecipeDeduplicate,
  selectRank,
  shipStat,
} from './v2.handlers'

export const registerReportV2Routes: FastifyPluginAsync = async (app) => {
  app.post('/create_ship', async (request, reply) =>
    sendResult(reply, await createShip(toAppRequest(request))),
  )
  app.post('/create_item', async (request, reply) =>
    sendResult(reply, await createItem(toAppRequest(request))),
  )
  app.post('/remodel_item', async (request, reply) =>
    sendResult(reply, await remodelItem(toAppRequest(request))),
  )
  app.post('/drop_ship', async (request, reply) =>
    sendResult(reply, await dropShip(toAppRequest(request))),
  )
  app.post('/select_rank', async (request, reply) =>
    sendResult(reply, await selectRank(toAppRequest(request))),
  )
  app.post('/pass_event', async (request, reply) =>
    sendResult(reply, await passEvent(toAppRequest(request))),
  )
  app.get('/known_quests', async (request, reply) =>
    sendResult(reply, await knownQuests(toAppRequest(request))),
  )
  app.post('/quest/:id', async (_request, reply) => sendResult(reply, await questNoop()))
  app.post('/battle_api', async (request, reply) =>
    sendResult(reply, await battleApi(toAppRequest(request))),
  )
  app.post('/night_contcat', async (request, reply) =>
    sendResult(reply, await nightContact(toAppRequest(request))),
  )
  app.post('/aaci', async (request, reply) => sendResult(reply, await aaci(toAppRequest(request))))
  app.get('/known_recipes', async (_request, reply) => sendResult(reply, await knownRecipes()))
  app.post('/remodel_recipe', async (request, reply) =>
    sendResult(reply, await remodelRecipe(toAppRequest(request))),
  )
  app.post('/remodel_recipe_deduplicate', async (request, reply) =>
    sendResult(reply, await remodelRecipeDeduplicate(toAppRequest(request))),
  )
  app.post('/night_battle_ci', async (request, reply) =>
    sendResult(reply, await nightBattleCi(toAppRequest(request))),
  )
  app.post('/night_battle_ss_ci', async (_request, reply) =>
    sendResult(reply, await nightBattleSsCi()),
  )
  app.post('/ship_stat', async (request, reply) =>
    sendResult(reply, await shipStat(toAppRequest(request))),
  )
  app.post('/enemy_info', async (request, reply) =>
    sendResult(reply, await enemyInfo(toAppRequest(request))),
  )
}
