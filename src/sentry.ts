import * as Sentry from '@sentry/node'
import { type ExpressRequest } from '@sentry/node/dist/handlers'
import { type Context } from '@sentry/types'
import { extractTraceparentData, stripUrlQueryAndFragment } from '@sentry/tracing'
import {
  type DefaultState,
  type DefaultContext,
  type Middleware,
  type ParameterizedContext,
} from 'koa'

const getHeaderValue = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value.join(',') : value

const getRequestBodyData = (ctx: ParameterizedContext) => {
  const body = ctx.request.body
  return body != null && typeof body === 'object' && 'data' in body ? body.data : undefined
}

const getRequestBodyContext = (ctx: ParameterizedContext): Context | null => {
  const data = getRequestBodyData(ctx)
  return data != null && typeof data === 'object' && !Array.isArray(data) ? (data as Context) : null
}

export const captureException = (
  err: Error,
  ctx: ParameterizedContext<DefaultState, DefaultContext>,
): void => {
  Sentry.withScope(function (scope) {
    scope.setUser({
      ip_address:
        getHeaderValue(ctx.headers['x-real-ip']) || getHeaderValue(ctx.headers['x-forwarded-for']),
    })
    scope.setTags({
      reporter:
        getHeaderValue(ctx.headers['x-reporter']) || getHeaderValue(ctx.headers['user-agent']),
      version: global.latestCommit?.slice(0, 8),
    })
    scope.addEventProcessor(function (event) {
      return Sentry.Handlers.parseRequest(event, ctx.request as any as ExpressRequest)
    })
    Sentry.captureException(err)
  })
}

export const sentryTracingMiddileaware: Middleware = async (ctx, next) => {
  const reqMethod = (ctx.method || '').toUpperCase()
  const reqUrl = ctx.url && stripUrlQueryAndFragment(ctx.url)

  // connect to trace of upstream app
  let traceparentData
  if (ctx.request.get('sentry-trace')) {
    traceparentData = extractTraceparentData(ctx.request.get('sentry-trace'))
  }

  const transaction = Sentry.startTransaction({
    name: `${reqMethod} ${reqUrl}`,
    op: 'http.server',
    ...traceparentData,
  })

  ctx.__sentry_transaction = transaction
  await next()

  const mountPath = ctx.mountPath || ''
  transaction.setName(`${reqMethod} ${mountPath}${ctx.path}`)

  transaction.setHttpStatus(ctx.status)
  Sentry.withScope((scope) => {
    scope.setUser({
      ip_address:
        getHeaderValue(ctx.headers['x-real-ip']) || getHeaderValue(ctx.headers['x-forwarded-for']),
    })
    scope.setTags({
      reporter:
        getHeaderValue(ctx.headers['x-reporter']) || getHeaderValue(ctx.headers['user-agent']),
      url: ctx.request.url,
      version: global.latestCommit?.slice(0, 8),
    })
    scope.setContext('data', getRequestBodyContext(ctx))
    transaction.finish()
  })
}
