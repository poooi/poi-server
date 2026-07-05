import * as Sentry from '@sentry/node'
import { type FastifyInstance } from 'fastify'
import { type Context, type Event, type Span } from '@sentry/core'

import { toAppRequest } from './http/fastify'
import { getClientIp, getHeader, type AppRequest } from './http/request'

declare module 'fastify' {
  interface FastifyRequest {
    sentrySpan?: Span
  }
}

const getRequestBodyData = (request: Pick<AppRequest, 'body'>) => {
  const body = request.body
  return body != null && typeof body === 'object' && !Array.isArray(body) && 'data' in body
    ? (body as { data?: unknown }).data
    : undefined
}

const getRequestBodyContext = (request: Pick<AppRequest, 'body'>): Context | null => {
  const data = getRequestBodyData(request)
  if (data == null) {
    return null
  }
  if (typeof data === 'object' && !Array.isArray(data)) {
    return data as Context
  }
  return { data }
}

const getRequestQueryString = (request: Pick<AppRequest, 'query'>) =>
  new URLSearchParams(
    Object.entries(request.query).flatMap(([key, value]) => (value == null ? [] : [[key, value]])),
  ).toString()

const createRequestEventProcessor =
  (request: AppRequest) =>
  (event: Event): Event => ({
    ...event,
    request: {
      ...event.request,
      data: getRequestBodyData(request),
      headers: {
        ...event.request?.headers,
        ...Object.fromEntries(
          Object.entries(request.headers).map(([key, value]) => [
            key,
            Array.isArray(value) ? value.join(',') : value || '',
          ]),
        ),
      },
      method: request.method,
      query_string: getRequestQueryString(request),
      url: request.url,
    },
  })

export const captureException = (err: Error, request: AppRequest): void => {
  Sentry.withScope(function (scope) {
    scope.setUser({
      ip_address: getClientIp(request),
    })
    scope.setTags({
      cf_connecting_ipv6: getHeader(request, 'cf-connecting-ipv6'),
      cf_country: getHeader(request, 'cf-ipcountry'),
      cf_pseudo_ipv4: getHeader(request, 'cf-pseudo-ipv4'),
      cf_ray: getHeader(request, 'cf-ray'),
      cf_worker: getHeader(request, 'cf-worker'),
      reporter: getHeader(request, 'x-reporter') || getHeader(request, 'user-agent'),
      url: request.url,
      version: global.latestCommit?.slice(0, 8),
    })
    scope.setContext('data', getRequestBodyContext(request))
    scope.addEventProcessor(createRequestEventProcessor(request))
    Sentry.captureException(err)
  })
}

export const registerSentryHooks = (app: FastifyInstance) => {
  app.decorateRequest('sentrySpan')

  app.addHook('onRequest', async (request) => {
    const reqMethod = (request.method || '').toUpperCase()
    const reqUrl = request.url.split('?')[0]

    const createSpan = () =>
      Sentry.startInactiveSpan({
        forceTransaction: true,
        name: `${reqMethod} ${reqUrl}`,
        op: 'http.server',
      })

    const sentryTraceHeader = request.headers['sentry-trace']
    const baggageHeader = request.headers.baggage
    const sentryTrace = Array.isArray(sentryTraceHeader) ? sentryTraceHeader[0] : sentryTraceHeader
    const baggage = Array.isArray(baggageHeader) ? baggageHeader[0] : baggageHeader
    if (sentryTrace != null) {
      request.sentrySpan = Sentry.continueTrace({ baggage, sentryTrace }, createSpan)
      return
    }

    request.sentrySpan = createSpan()
  })

  app.addHook('onResponse', async (request, reply) => {
    const span = request.sentrySpan
    if (span == null) {
      return
    }

    const appRequest = toAppRequest(request)
    span.updateName(`${request.method.toUpperCase()} ${appRequest.path}`)
    Sentry.setHttpStatus(span, reply.statusCode)
    Sentry.withActiveSpan(span, () => {
      Sentry.withScope((scope) => {
        scope.setUser({
          ip_address: getClientIp(appRequest),
        })
        scope.setTags({
          cf_connecting_ipv6: getHeader(appRequest, 'cf-connecting-ipv6'),
          cf_country: getHeader(appRequest, 'cf-ipcountry'),
          cf_pseudo_ipv4: getHeader(appRequest, 'cf-pseudo-ipv4'),
          cf_ray: getHeader(appRequest, 'cf-ray'),
          cf_worker: getHeader(appRequest, 'cf-worker'),
          reporter: getHeader(appRequest, 'x-reporter') || getHeader(appRequest, 'user-agent'),
          url: request.url,
          version: global.latestCommit?.slice(0, 8),
        })
        scope.setContext('data', getRequestBodyContext(appRequest))
        span.end()
      })
    })
  })

  app.addHook('onError', async (request, _reply, error) => {
    captureException(error, toAppRequest(request))
  })
}
