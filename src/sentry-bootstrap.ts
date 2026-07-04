import * as Sentry from '@sentry/node'
import { Integrations } from '@sentry/tracing'

import { config } from './config'

export const initSentry = (): void => {
  Sentry.init({
    dsn: 'https://99bc543aa0984d51917e02a873bb244f@o171991.ingest.sentry.io/5594215',
    environment: config.env,
    tracesSampleRate: 0.001,
    integrations: [new Integrations.Mongo()],
  })
}
