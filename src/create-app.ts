import Koa from 'koa'
import bodyparser from 'koa-bodyparser'
import cache from 'koa-cash'
import logger from 'koa-pino-logger'
import Cache from 'node-cache'

import { config } from './config'
import { captureException, sentryTracingMiddleware } from './sentry'

import './models'
import { router } from './controllers'

interface CreateAppOptions {
  disableLogger?: boolean
}

const cacheCompressionThreshold = 1024 ** 3

export const createApp = ({
  disableLogger = Boolean(config.disableLogger),
}: CreateAppOptions = {}) => {
  const app = new Koa()

  app.use(sentryTracingMiddleware)

  if (!disableLogger) {
    app.use(logger())
  }

  const _cache = new Cache({
    stdTTL: 10 * 60,
    checkperiod: 0,
  })
  app.use(
    cache({
      threshold: cacheCompressionThreshold,
      get: async (key) => _cache.get(key),
      set: async (key, value, maxAge) => {
        _cache.set(key, value, maxAge != null && maxAge > 0 ? maxAge : 0)
      },
    }),
  )

  app.use(
    bodyparser({
      strict: true,
      onerror: (err, ctx) => {
        captureException(err, ctx)
        console.error(`bodyparser error`)
      },
    }),
  )

  app.use(router.routes())

  return app
}
