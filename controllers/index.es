import Router from '@koa/router'

import { router as othersRouter } from './api/others'
import { router as reportV2Router } from './api/report/v2'

export const router = new Router()

router.use('/api', othersRouter.routes(), othersRouter.allowedMethods())

router.use('/api/report/v2', reportV2Router.routes(), reportV2Router.allowedMethods())
