Promise = require('bluebird')
router = require('koa-router')()
df = Promise.promisify(require('df'))
childProcess = require('child_process')

mongoose = require('mongoose')
CreateShipRecord = mongoose.model 'CreateShipRecord'
CreateItemRecord = mongoose.model 'CreateItemRecord'
RemodelItemRecord = mongoose.model 'RemodelItemRecord'
DropShipRecord = mongoose.model 'DropShipRecord'
SelectRankRecord = mongoose.model 'SelectRankRecord'
PassEventRecord = mongoose.model 'PassEventRecord'
Quest = mongoose.model 'Quest'
BattleAPI = mongoose.model 'BattleAPI'
NightContactRecord = mongoose.model 'NightContactRecord'

config = require('../../config')

router.get '/api/status', (next) ->
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
      Quest: yield Quest.countAsync()
      BattleAPI: yield BattleAPI.countAsync()
      NightContactRecord: yield NightContactRecord.countAsync()

router.post '/api/github-master-hook', (next) ->
  yield next
  update = childProcess.spawn(config.root + '/github-master-hook', [])
  update.stdout.on 'data', (data) ->
    console.log('GitHub hook out: ' + data)
  update.stderr.on 'data', (data) ->
    console.log('GitHub hook err: ' + data)
  update.on 'close', (code) ->
    console.log('GitHub hook exit: ' + code)
  @response.status = 200
  @response.body =
    code: 0

module.exports = (app) ->
  app.use router.routes()
