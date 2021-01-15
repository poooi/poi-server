import * as Sentry from '@sentry/node'

Sentry.init({
  dsn: "https://99bc543aa0984d51917e02a873bb244f@o171991.ingest.sentry.io/5594215",
})


export const captureException = (err, ctx) => {
  Sentry.withScope(function(scope) {
    scope.setUser({ ip_address: ctx.headers['x-real-ip'] || ctx.headers['x-forwarded-for'] })
    scope.addEventProcessor(function(event) {
      return Sentry.Handlers.parseRequest(event, ctx.request)
    })
    Sentry.captureException(err)
  })
}
