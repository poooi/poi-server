Promise = require 'bluebird'
path = require 'path'
glob = require 'glob'
koa = require 'koa'
logger = require 'koa-logger'
serve = require 'koa-static'
mongoose = Promise.promisifyAll require 'mongoose'
config = require './config'

app = koa()

# Database
mongoose.connect config.db
db = mongoose.connection
db.on 'error', ->
  throw new Error('Unable to connect to database at ' + config.db)

# Logger
app.use logger()

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

app.listen config.port, ->
  console.log "Koa is listening on port #{config.port}"
