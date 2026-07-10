import { type FastifyPluginAsync } from 'fastify'

import { type DatabaseBackend } from '../../db/backend'
import { sendResult } from '../../http/fastify'
import {
  getLatestCommit,
  getServiceStatusBadge,
  getServiceVersionBadge,
  getStatus,
  runGithubMasterHook,
  svgHeaders,
} from './others.handlers'

interface OtherRouteOptions {
  backend?: DatabaseBackend
}

export const registerOtherApiRoutes: FastifyPluginAsync<OtherRouteOptions> = async (
  app,
  { backend = 'mongo' },
) => {
  app.get('/status', async (_request, reply) => sendResult(reply, await getStatus(backend)))
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
