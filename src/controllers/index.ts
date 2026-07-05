import { type FastifyPluginAsync } from 'fastify'

import { registerOtherApiRoutes } from './api/others.fastify'
import { registerReportV2Routes } from './api/report/v2.fastify'
import { registerReportV3Routes } from './api/report/v3.fastify'

export const registerRoutes: FastifyPluginAsync = async (app) => {
  await app.register(registerOtherApiRoutes, { prefix: '/api' })
  await app.register(registerReportV2Routes, { prefix: '/api/report/v2' })
  await app.register(registerReportV3Routes, { prefix: '/api/report/v3' })
}
