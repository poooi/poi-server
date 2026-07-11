import dotenv from 'dotenv'

dotenv.config()

void import('./sentry-bootstrap')
  .then(async ({ initSentry }) => {
    const { config } = await import('./config')
    initSentry(config.db)
    await import('./app')
  })
  .catch(async (err) => {
    console.error(err)
    try {
      const Sentry = await import('@sentry/node')
      Sentry.captureException(err)
      await Sentry.flush(2000)
    } catch (sentryErr) {
      console.error(sentryErr)
    }
    process.exit(1)
  })
