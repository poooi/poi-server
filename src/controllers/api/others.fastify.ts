import { type FastifyPluginAsync } from 'fastify'

import { sendResult } from '../../http/fastify'
import {
  getLatestCommit,
  getServiceStatusBadge,
  getServiceVersionBadge,
  getStatus,
  runGithubMasterHook,
  svgHeaders,
} from './others.handlers'

export const registerOtherApiRoutes: FastifyPluginAsync = async (app) => {
  app.get('/status', async (_request, reply) => sendResult(reply, await getStatus()))
  app.post('/github-master-hook', async (_request, reply) =>
    sendResult(reply, await runGithubMasterHook()),
  )
  app.get('/latest-commit', async (_request, reply) => sendResult(reply, await getLatestCommit()))
  app.get('/service-status-badge', async (_request, reply) =>
    sendResult(reply, {
      ...(await getServiceStatusBadge()),
      headers: svgHeaders,
    }),
  )
  app.get('/service-version-badge', async (_request, reply) =>
    sendResult(reply, {
      ...(await getServiceVersionBadge()),
      headers: svgHeaders,
    }),
  )
}
