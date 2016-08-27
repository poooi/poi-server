Promise = require('bluebird')
router = require('koa-router')()
df = Promise.promisify(require('df'))

mongoose = require('mongoose')
CreateShipRecord = mongoose.model 'CreateShipRecord'
CreateItemRecord = mongoose.model 'CreateItemRecord'
RemodelItemRecord = mongoose.model 'RemodelItemRecord'
DropShipRecord = mongoose.model 'DropShipRecord'
SelectRankRecord = mongoose.model 'SelectRankRecord'
PassEventRecord = mongoose.model 'PassEventRecord'
Quest = mongoose.model 'Quest'

router.get '/status', (next) ->
  yield next
  ret = yield df()
  @response.status = 200
  @response.body =
    env: process.env.NODE_ENV
    disk: ret.filter((e) -> e.mountpoint == '/')
    mongo:
      CreateShipRecord: yield CreateShipRecord.countAsync()
      CreateItemRecord: yield CreateItemRecord.countAsync()
      RemodelItemRecord: yield RemodelItemRecord.countAsync()
      DropShipRecord: yield DropShipRecord.countAsync()
      SelectRankRecord: yield SelectRankRecord.countAsync()
      PassEventRecord: yield PassEventRecord.countAsync()
      Quest: yield Quest.count()

module.exports = (app) ->
  app.use router.routes()
