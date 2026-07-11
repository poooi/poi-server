import { type FastifyPluginAsync } from 'fastify'

import { type DatabaseStatus } from '../contracts/database'
import { registerOtherApiRoutes } from './api/others.fastify'
import { registerReportV2Routes, type ReportV2Actions } from './api/report/v2.fastify'
import { registerReportV3Routes, type ReportV3Actions } from './api/report/v3.fastify'

export interface RegisterRoutesOptions {
  getDatabaseStatus?: () => Promise<DatabaseStatus>
  reportV2Actions?: ReportV2Actions
  reportV3Actions?: ReportV3Actions
}

export const registerRoutes: FastifyPluginAsync<RegisterRoutesOptions> = async (app, options) => {
  await app.register(registerOtherApiRoutes, {
    prefix: '/api',
    getDatabaseStatus: options.getDatabaseStatus,
  })
  await app.register(registerReportV2Routes, {
    prefix: '/api/report/v2',
    actions: options.reportV2Actions,
  })
  await app.register(registerReportV3Routes, {
    prefix: '/api/report/v3',
    actions: options.reportV3Actions,
  })
}
