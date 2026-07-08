import * as Sentry from '@sentry/node'

import { config } from './config'

export const initSentry = (): void => {
  Sentry.init({
    dsn: 'https://99bc543aa0984d51917e02a873bb244f@o171991.ingest.sentry.io/5594215',
    environment: config.env,
    tracesSampleRate: 0.001,
    // MongoDB-only for now; a later backend phase will gate this integration by database backend.
    integrations: [Sentry.mongoIntegration()],
  })
}
