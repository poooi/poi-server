router = require('koa-router')()
parse = require('co-body')
mongoose = require 'mongoose'

CreateShipRecord = mongoose.model 'CreateShipRecord'
CreateItemRecord = mongoose.model 'CreateItemRecord'
DropShipRecord = mongoose.model 'DropShipRecord'

router.post '/api/report/v2/create_ship', (next) ->
  yield next
  try
    body = yield parse.form @
    info = JSON.parse body.data
    record = new CreateShipRecord info
    yield record.saveAsync()
    @response.status = 200
    @response.body =
      code: 0
  catch err
    console.error e
    @response.status = 500
    @response.body =
      code: -1

router.post '/api/report/v2/create_item', (next) ->
  yield next
  try
    body = yield parse.form @
    info = JSON.parse body.data
    record = new CreateItemRecord info
    yield record.saveAsync()
    @response.status = 200
    @response.body =
      code: 0
  catch err
    console.error e
    @response.status = 500
    @response.body =
      code: -1

router.post '/api/report/v2/drop_ship', (next) ->
  yield next
  try
    body = yield parse.form @
    info = JSON.parse body.data
    record = new DropShipRecord info
    yield record.saveAsync()
    @response.status = 200
    @response.body =
      code: 0
  catch err
    console.error e
    @response.status = 500
    @response.body =
      code: -1

module.exports = (app) ->
  app.use router.routes()
