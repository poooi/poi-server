_ = require('lodash');
router = require('koa-router')()
parse = require('co-body')
mongoose = require('mongoose')

CreateShipRecord = mongoose.model 'CreateShipRecord'
CreateItemRecord = mongoose.model 'CreateItemRecord'
RemodelItemRecord = mongoose.model 'RemodelItemRecord'
DropShipRecord = mongoose.model 'DropShipRecord'
SelectRankRecord = mongoose.model 'SelectRankRecord'
PassEventRecord = mongoose.model 'PassEventRecord'
Quest = mongoose.model 'Quest'

router.post '/api/report/v2/create_ship', (next) ->
  yield next
  try
    body = yield parse.form @
    info = JSON.parse body.data
    if !info.origin? && @headers['user-agent']?
      info.origin = @headers['user-agent']
    record = new CreateShipRecord info
    yield record.saveAsync()
    @response.status = 200
    @response.body =
      code: 0
  catch err
    console.error err
    @response.status = 500
    @response.body =
      code: -1

router.post '/api/report/v2/create_item', (next) ->
  yield next
  try
    body = yield parse.form @
    info = JSON.parse body.data
    if !info.origin? && @headers['user-agent']?
      info.origin = @headers['user-agent']
    record = new CreateItemRecord info
    yield record.saveAsync()
    @response.status = 200
    @response.body =
      code: 0
  catch err
    console.error err
    @response.status = 500
    @response.body =
      code: -1

router.post '/api/report/v2/remodel_item', (next) ->
  yield next
  try
    body = yield parse.form @
    info = JSON.parse body.data
    if !info.origin? && @headers['user-agent']?
      info.origin = @headers['user-agent']
    record = new RemodelItemRecord info
    yield record.saveAsync()
    @response.status = 200
    @response.body =
      code: 0
  catch err
    console.error err
    @response.status = 500
    @response.body =
      code: -1

router.post '/api/report/v2/drop_ship', (next) ->
  yield next
  try
    body = yield parse.form @
    info = JSON.parse body.data
    if !info.origin? && @headers['user-agent']?
      info.origin = @headers['user-agent']
    record = new DropShipRecord info
    yield record.saveAsync()
    @response.status = 200
    @response.body =
      code: 0
  catch err
    console.error err
    @response.status = 500
    @response.body =
      code: -1

router.post '/api/report/v2/select_rank', (next) ->
  yield next
  try
    body = yield parse.form @
    info = JSON.parse body.data
    if !info.origin? && @headers['user-agent']?
      info.origin = @headers['user-agent']
    record = yield SelectRankRecord.findOne({
      teitokuId: info.teitokuId,
      mapareaId: info.mapareaId
    }).execAsync()
    if record?
      record.teitokuLv = info.teitokuLv
      record.rank = info.rank
      record.origin = info.origin
    else
      record = new SelectRankRecord info
    yield record.saveAsync()
    @response.status = 200
    @response.body =
      code: 0
  catch err
    console.error err
    @response.status = 500
    @response.body =
      code: -1

router.post '/api/report/v2/pass_event', (next) ->
  yield next
  try
    body = yield parse.form @
    info = JSON.parse body.data
    if !info.origin? && @headers['user-agent']?
      info.origin = @headers['user-agent']
    record = new PassEventRecord info
    yield record.saveAsync()
    @response.status = 200
    @response.body =
      code: 0
  catch err
    console.error err
    @response.status = 500
    @response.body =
      code: -1

# Use knownQuests to cache current known quests state.
router.get '/api/report/v2/known_quests', (next) ->
  yield next
  try
    knownQuests = yield Quest.find().distinct('questId').execAsync()
    knownQuests.sort()
    @response.status = 200
    @response.body =
      code: 0
      quests: knownQuests
  catch err
    console.error err
    @response.status = 500
    @response.body =
      code: -1

router.post '/api/report/v2/quest/:id', (next) ->
  yield next
  try
    body = yield parse.form @
    info = JSON.parse body.data
    if !info.origin? && @headers['user-agent']?
      info.origin = @headers['user-agent']
    record = new Quest info
    yield record.saveAsync()
    @response.status = 200
    @response.body =
      code: 0
  catch err
    @response.status = 500
    @response.body =
      code: -1

module.exports = (app) ->
  app.use router.routes()
