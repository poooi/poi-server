import Fastify from 'fastify'

import { config } from './config'
import './models'
import { registerRoutes } from './controllers'
import { registerSentryHooks } from './sentry'

interface CreateAppOptions {
  disableLogger?: boolean
}

export const createApp = ({
  disableLogger = Boolean(config.disableLogger),
}: CreateAppOptions = {}) => {
  const app = Fastify({
    bodyLimit: 1024 * 1024,
    logger: disableLogger ? false : true,
  })

  registerSentryHooks(app)

  app.setErrorHandler((_err, _request, reply) => {
    return reply.code(500).send()
  })

  void app.register(registerRoutes)

  return app
}
