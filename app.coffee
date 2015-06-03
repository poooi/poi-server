Promise = require 'bluebird'
path = require 'path'
glob = require 'glob'
koa = require 'koa'
compress = require 'koa-compress'
logger = require 'koa-logger'
serve = require 'koa-static'
mongoose = Promise.promisifyAll require 'mongoose'
config = require './config'
render = require('co-views') 'views',
  map:
    jade: 'jade'
  default: 'jade'

app = koa()

# Database
mongoose.connect config.db
db = mongoose.connection
db.on 'error', ->
  throw new Error('Unable to connect to database at ' + config.db)

# Logger
app.use logger()

# Template Engine
app.use (next) ->
  @render = (name, options) ->
    options.env = app.env
    @body = yield render name, options
  yield next

# Models
glob.sync path.join config.root, 'models/**/*.coffee'
.forEach (model) ->
  require model

# Controllers
glob.sync path.join config.root, 'controllers/**/*.coffee'
.forEach (controller) ->
  require(controller)(app)

# Static
app.use serve path.join config.root, 'public'

# Compress
app.use compress()

app.listen config.port, ->
  console.log "Koa is listening on port #{config.port}"
