import Router from '@koa/router'

import { router as othersRouter } from './api/others.ts'
import { router as reportV2Router } from './api/report/v2.ts'
import { router as reportV3Router } from './api/report/v3.ts'

export const router = new Router()

router.use('/api', othersRouter.routes(), othersRouter.allowedMethods())

router.use('/api/report/v2', reportV2Router.routes(), reportV2Router.allowedMethods())

router.use('/api/report/v3', reportV3Router.routes(), reportV3Router.allowedMethods())
