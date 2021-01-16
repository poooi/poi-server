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
import childProcess from 'child_process'
import { trim } from 'lodash'

import config from './config'
import { captureException, sentryTracingMiddileaware } from './sentry'

bluebird.promisifyAll(mongoose)
mongoose.Promise = Promise

const app = new Koa()

// Database
mongoose.connect(config.db)
mongoose.connection.on('error', () => {
  throw new Error('Unable to connect to database at ' + config.db)
})

app.use(sentryTracingMiddileaware)

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

app.on('error', captureException)

childProcess.exec('git rev-parse HEAD', (err, stdout) => {
  if (!err) {
    global.latestCommit = trim(stdout)
  } else {
    console.error(err)
  }
})
