import Fastify from 'fastify'

import { config } from './config'
import './models'
import { registerRoutes } from './controllers'
import { registerSentryHooks } from './sentry'

interface CreateAppOptions {
  disableLogger?: boolean
}

const getErrorStatusCode = (err: unknown) => {
  if (
    err != null &&
    typeof err === 'object' &&
    'statusCode' in err &&
    typeof err.statusCode === 'number' &&
    err.statusCode >= 400 &&
    err.statusCode < 600
  ) {
    return err.statusCode
  }
  return 500
}

export const createApp = ({
  disableLogger = Boolean(config.disableLogger),
}: CreateAppOptions = {}) => {
  const app = Fastify({
    bodyLimit: 1024 * 1024,
    logger: disableLogger ? false : true,
  })

  registerSentryHooks(app)

  app.setErrorHandler((err, _request, reply) => {
    const statusCode = getErrorStatusCode(err)
    return reply.code(statusCode).send(statusCode >= 500 ? undefined : err)
  })

  void app.register(registerRoutes)

  return app
}
