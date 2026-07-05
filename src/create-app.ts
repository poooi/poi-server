import Fastify from 'fastify'
import { randomUUID } from 'crypto'

import { config } from './config'
import './models'
import { registerRoutes } from './controllers'
import { registerSentryHooks } from './sentry'

interface CreateAppOptions {
  disableLogger?: boolean
}

const getHeaderValue = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value.join(',') : value

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

const createLoggerOptions = (disableLogger: boolean) =>
  disableLogger
    ? false
    : {
        level: config.logLevel,
        redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["set-cookie"]'],
        serializers: {
          req: (request: {
            headers: Record<string, string | string[] | undefined>
            hostname?: string
            id?: string
            ip?: string
            method?: string
            socket?: { remotePort?: number }
            url?: string
          }) => ({
            host: request.hostname,
            id: request.id,
            ip:
              getHeaderValue(request.headers['x-real-ip']) ||
              getHeaderValue(request.headers['x-forwarded-for']) ||
              request.ip,
            method: request.method,
            remotePort: request.socket?.remotePort,
            reporter: getHeaderValue(request.headers['x-reporter']),
            url: request.url,
            userAgent: getHeaderValue(request.headers['user-agent']),
          }),
          res: (reply: { statusCode?: number }) => ({
            statusCode: reply.statusCode,
          }),
        },
      }

export const createApp = ({
  disableLogger = Boolean(config.disableLogger),
}: CreateAppOptions = {}) => {
  const app = Fastify({
    bodyLimit: 1024 * 1024,
    genReqId: (request) =>
      getHeaderValue(request.headers['x-request-id']) ||
      getHeaderValue(request.headers['x-correlation-id']) ||
      randomUUID(),
    logger: createLoggerOptions(disableLogger),
  })

  registerSentryHooks(app)

  app.setErrorHandler((err, request, reply) => {
    const statusCode = getErrorStatusCode(err)
    const message = err instanceof Error && err.message !== '' ? err.message : 'Invalid request'
    if (statusCode >= 500) {
      request.log.error({ err }, 'Unhandled request error')
    }
    return reply.code(statusCode).send(statusCode >= 500 ? undefined : { error: message })
  })

  void app.register(registerRoutes)

  return app
}
