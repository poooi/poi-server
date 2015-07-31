router = require('koa-router')()
parse = require('co-body')
mongoose = require 'mongoose'

EnemyInformation = mongoose.model 'EnemyInformation'

router.post '/api/prophet/:id/update', (next) ->
  yield next
  try
    body = yield parse.form @
    detail = JSON.parse body.data
    detail.enemyId = @params.id
    saved = yield EnemyInformation.findOne
      enemyId: @params.id
    .execAsync()
    if saved?
      for k, v of body.data
        saved[k] = v
      yield saved.saveAsync()
    else
      record = new EnemyInformation detail
      yield record.saveAsync()
    @response.status = 200
    @response.body =
      code: 0
  catch e
    console.error e
    @response.status = 500
    @response.body =
      code: -1

router.get '/api/prophet/sync', (next) ->
  yield next
  try
    enemies = yield EnemyInformation.find().execAsync()
    res = {}
    for enemy in enemies
      res[enemy.enemyId] = enemy
    @response.status = 200
    @response.body =
      code: 0
      data: res
  catch e
    console.error e
    @response.status = 500
    @response.body =
      code: -1

module.exports = (app) ->
  app.use router.routes()
