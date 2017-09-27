const Koa = require('koa')
const Router = require('koa-router')
const ChildProcess = require('child_process')

const app = new Koa()
const router = new Router()

router.post('/api/github-master-hook', async (ctx, next) => {
  console.log(`==================== ${new Date} ====================`)
  const cp = ChildProcess.spawn('./github-master-hook', {stdio: 'inherit'})
  cp.on('close', (code) => console.log('* exit code:' + code))
  ctx.status = 200
  await next()
})

// Start server
const Port = 11280
app.use(router.routes())
app.listen(Port, '127.0.0.1', () => {
  console.log(`Server is listening at port ${Port}`)
})
