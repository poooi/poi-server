import Fastify from 'fastify'
import { randomUUID } from 'crypto'

import { config } from './config'
import { type DatabaseBackend } from './db/backend'
import './models'
import { registerRoutes } from './controllers'
import { registerSentryHooks } from './sentry'

interface CreateAppOptions {
  backend?: DatabaseBackend
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
            cfConnectingIpv6: getHeaderValue(request.headers['cf-connecting-ipv6']),
            cfCountry: getHeaderValue(request.headers['cf-ipcountry']),
            cfPseudoIpv4: getHeaderValue(request.headers['cf-pseudo-ipv4']),
            cfRay: getHeaderValue(request.headers['cf-ray']),
            cfWorker: getHeaderValue(request.headers['cf-worker']),
            host: request.hostname,
            id: request.id,
            ip:
              getHeaderValue(request.headers['cf-connecting-ipv6']) ||
              getHeaderValue(request.headers['cf-connecting-ip']) ||
              getHeaderValue(request.headers['true-client-ip']) ||
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
  backend = 'mongo',
  disableLogger = Boolean(config.disableLogger),
}: CreateAppOptions = {}) => {
  const app = Fastify({
    bodyLimit: 1024 * 1024,
    genReqId: (request) =>
      getHeaderValue(request.headers['x-request-id']) ||
      getHeaderValue(request.headers['x-correlation-id']) ||
      getHeaderValue(request.headers['cf-ray']) ||
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

  void app.register(registerRoutes, { backend })

  return app
}
