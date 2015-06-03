router = require('koa-router')()

router.get '/', (next) ->
  yield next
  yield @render 'index',
    title: 'Index'

module.exports = (app) ->
  app.use router.routes()
