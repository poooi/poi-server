router = require('koa-router')()
parse = require('co-body')
mongoose = require 'mongoose'

CreateShipRecord = mongoose.model 'CreateShipRecord'
DropShipRecord = mongoose.model 'DropShipRecord'
Quest = mongoose.model 'Quest'

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

router.post '/api/report/quest_list', (next) ->
  yield next
  try
    body = yield parse.form @
    detail = JSON.parse body.data
    for q in detail
      continue if q is -1
      quest = yield Quest.findOne
        questId: q.api_no
      .execAsync()
      continue if quest?
      quest = new Quest
        questId: q.api_no
        title: q.api_title
        detail: q.api_detail
        category: q.api_category
        type: q.api_type
      yield quest.saveAsync()
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
