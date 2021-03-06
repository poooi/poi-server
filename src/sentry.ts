import * as Sentry from '@sentry/node'
import { ExpressRequest } from '@sentry/node/dist/handlers'
import { extractTraceparentData, stripUrlQueryAndFragment, Integrations } from '@sentry/tracing'
import { DefaultState, DefaultContext, Middleware, ParameterizedContext } from 'koa'

import { config } from './config'

Sentry.init({
  dsn: 'https://99bc543aa0984d51917e02a873bb244f@o171991.ingest.sentry.io/5594215',
  environment: config.env,
  tracesSampleRate: 0.001,
  integrations: [new Integrations.Mongo()],
})

export const captureException = (
  err: Error,
  ctx: ParameterizedContext<DefaultState, DefaultContext>,
): void => {
  Sentry.withScope(function (scope) {
    scope.setUser({ ip_address: ctx.headers['x-real-ip'] || ctx.headers['x-forwarded-for'] })
    scope.setTags({
      reporter: ctx.headers['x-reporter'] || ctx.headers['user-agent'],
      version: global.latestCommit?.slice(0, 8),
    })
    scope.addEventProcessor(function (event) {
      return Sentry.Handlers.parseRequest(event, (ctx.request as any) as ExpressRequest)
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
    scope.setUser({ ip_address: ctx.headers['x-real-ip'] || ctx.headers['x-forwarded-for'] })
    scope.setTags({
      reporter: ctx.headers['x-reporter'] || ctx.headers['user-agent'],
      url: ctx.request.url,
      version: global.latestCommit?.slice(0, 8),
    })
    scope.setContext('data', ctx.request.body.data)
    transaction.finish()
  })
}
