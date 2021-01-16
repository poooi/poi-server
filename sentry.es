import * as Sentry from '@sentry/node'
import { extractTraceparentData, stripUrlQueryAndFragment, Integrations } from '@sentry/tracing'

import config from './config'

Sentry.init({
  dsn: "https://99bc543aa0984d51917e02a873bb244f@o171991.ingest.sentry.io/5594215",
  environment: config.env,
  tracesSampleRate: 0.001,
  integrations: [
    new Integrations.Mongo(),
  ],
})

export const captureException = (err, ctx) => {
  Sentry.withScope(function(scope) {
    scope.setUser({ ip_address: ctx.headers['x-real-ip'] || ctx.headers['x-forwarded-for'] })
    scope.setTags({
      reporter: ctx.headers['x-reporter'] || ctx.headers['user-agent'],
    })
    scope.addEventProcessor(function(event) {
      return Sentry.Handlers.parseRequest(event, ctx.request)
    })
    Sentry.captureException(err)
  })
}

export const sentryTracingMiddileaware = async (ctx, next) => {
  Sentry.withScope(scope => {})
  const reqMethod = (ctx.method || '').toUpperCase()
  const reqUrl = ctx.url && stripUrlQueryAndFragment(ctx.url)

  // connect to trace of upstream app
  let traceparentData
  if (ctx.request.get("sentry-trace")) {
    traceparentData = extractTraceparentData(ctx.request.get("sentry-trace"))
  }

  const transaction = Sentry.startTransaction({
    name: `${reqMethod} ${reqUrl}`,
    op: "http.server",
    ...traceparentData,
  })

  ctx.__sentry_transaction = transaction
  await next()

  // if using koa router, a nicer way to capture transaction using the matched route
  if (ctx._matchedRoute) {
    const mountPath = ctx.mountPath || ""
    transaction.setName(`${reqMethod} ${mountPath}${ctx._matchedRoute}`)
  }
  transaction.setHttpStatus(ctx.status)
  Sentry.withScope(scope => {
    scope.setUser({ ip_address: ctx.headers['x-real-ip'] || ctx.headers['x-forwarded-for'] })
    scope.setTags({
      reporter: ctx.headers['x-reporter'] || ctx.headers['user-agent'],
    })
    transaction.finish()
  })
}
