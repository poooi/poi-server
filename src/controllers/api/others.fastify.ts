import { type FastifyPluginAsync } from 'fastify'

import { type DatabaseStatus } from '../../contracts/database'
import { sendResult } from '../../http/fastify'
import {
  createGetStatus,
  getLatestCommit,
  getServiceStatusBadge,
  getServiceVersionBadge,
  runGithubMasterHook,
  svgHeaders,
} from './others.handlers'

interface OtherApiRouteOptions {
  getDatabaseStatus?: () => Promise<DatabaseStatus>
}

export const registerOtherApiRoutes: FastifyPluginAsync<OtherApiRouteOptions> = async (
  app,
  options,
) => {
  const getStatus = createGetStatus(options.getDatabaseStatus)

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
