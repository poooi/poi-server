import bluebird from 'bluebird'
import Koa from 'koa'
import bodyparser from 'koa-bodyparser'
import cache from 'koa-cash'
import logger from 'koa-logger'
import serve from 'koa-static'
import Cache from 'node-cache'
import path from 'path'
import glob from 'glob'
import mongoose from 'mongoose'
import * as Sentry from '@sentry/node'

import config from './config'
bluebird.promisifyAll(mongoose)
mongoose.Promise = Promise

Sentry.init({
  dsn: "https://99bc543aa0984d51917e02a873bb244f@o171991.ingest.sentry.io/5594215",
})

const app = new Koa()

// Database
mongoose.connect(config.db)
mongoose.connection.on('error', () => {
  throw new Error('Unable to connect to database at ' + config.db)
})

// Logger
if (! config.disableLogger) {
  app.use(logger())
}

// Cache
const _cache = new Cache({
  stdTTL: 10 * 60,
  checkperiod: 0,
})
app.use(cache({
  threshold: '1GB',  // Compression is handled by nginx.
  get: (key, maxAge) =>
    _cache.get(key),
  set: (key, value, maxAge) =>
    _cache.set(key, value, maxAge > 0 ? maxAge : null),
}))

// Body Parser
app.use(bodyparser({
  strict: true,
  onerror: (err, ctx) => {
    console.error(`bodyparser error`)
  },
}))

// Models
glob.sync(path.join(config.root, 'models/**'), { nodir: true })
  .forEach((file) => require(file))

// Controllers
glob.sync(path.join(config.root, 'controllers/**'), { nodir: true })
  .forEach((file) => require(file)(app))

// Static
app.use(serve(path.join(config.root, 'public')))

app.listen(config.port, '127.0.0.1', () => {
  console.log(`Koa is listening on port ${config.port}`)
})

app.on('error', (err, ctx) => {
  Sentry.withScope(function(scope) {
    scope.addEventProcessor(function(event) {
      return Sentry.Handlers.parseRequest(event, ctx.request)
    })
    Sentry.captureException(err)
  })
})
