import * as Sentry from '@sentry/node'

import { config } from './config'
import { resolveDatabaseBackend } from './db/backend'

export const initSentry = (databaseUrl = config.db): void => {
  const backend = resolveDatabaseBackend(databaseUrl)
  Sentry.init({
    dsn: 'https://99bc543aa0984d51917e02a873bb244f@o171991.ingest.sentry.io/5594215',
    environment: config.env,
    tracesSampleRate: 0.001,
    initialScope: {
      tags: {
        database_backend: backend,
      },
    },
    integrations: [
      backend === 'mongodb' ? Sentry.mongoIntegration() : Sentry.postgresIntegration(),
    ],
  })
}
