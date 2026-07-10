import { type FastifyPluginAsync } from 'fastify'

import { type DatabaseBackend } from '../db/backend'
import { registerOtherApiRoutes } from './api/others.fastify'
import { registerReportV2Routes } from './api/report/v2.fastify'
import { registerReportV3Routes } from './api/report/v3.fastify'

interface RouteOptions {
  backend?: DatabaseBackend
}

export const registerRoutes: FastifyPluginAsync<RouteOptions> = async (
  app,
  { backend = 'mongo' },
) => {
  await app.register(registerOtherApiRoutes, { backend, prefix: '/api' })
  await app.register(registerReportV2Routes, { backend, prefix: '/api/report/v2' })
  await app.register(registerReportV3Routes, { backend, prefix: '/api/report/v3' })
}
