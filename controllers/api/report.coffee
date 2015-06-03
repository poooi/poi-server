router = require('koa-router')()
parse = require('co-body')
mongoose = require 'mongoose'

CreateShipRecord = mongoose.model 'CreateShipRecord'
DropShipRecord = mongoose.model 'DropShipRecord'

router.post '/api/report/create_ship', (next) ->
  yield next
  try
    body = yield parse.form @
    detail = JSON.parse body.data
    record = new CreateShipRecord detail
    yield record.saveAsync()
    @response.status = 200
    @response.body =
      code: 0
  catch e
    console.error e
    @response.status = 500
    @response.body =
      code: -1

router.post '/api/report/drop_ship', (next) ->
  yield next
  try
    body = yield parse.form @
    detail = JSON.parse body.data
    record = new DropShipRecord detail
    yield record.saveAsync()
    @response.status = 200
    @response.body =
      code: 0
  catch e
    console.error e
    @response.status = 500
    @response.body =
      code: -1

module.exports = (app) ->
  app.use router.routes()
