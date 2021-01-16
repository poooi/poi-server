import bluebird from 'bluebird'
import Router from '@koa/router'
import df from 'df'
import childProcess from 'child_process'
import mongoose from 'mongoose'
import config from '../../config'

const dfAsync = bluebird.promisify(df)
const router = Router()

const CreateShipRecord   = mongoose.model('CreateShipRecord')
const CreateItemRecord   = mongoose.model('CreateItemRecord')
const RemodelItemRecord  = mongoose.model('RemodelItemRecord')
const DropShipRecord     = mongoose.model('DropShipRecord')
const SelectRankRecord   = mongoose.model('SelectRankRecord')
const PassEventRecord    = mongoose.model('PassEventRecord')
const Quest              = mongoose.model('Quest')
const BattleAPI          = mongoose.model('BattleAPI')
const AACIRecord         = mongoose.model('AACIRecord')
const NightContactRecord = mongoose.model('NightContactRecord')

router.get('/api/status', async (ctx, next) => {
  const dsk = await dfAsync()
  const ret = {
    env : process.env.NODE_ENV,
    disk: dsk.filter(e => e.mountpoint == '/'),
    mongo: {
      CreateShipRecord  : await CreateShipRecord.countAsync(),
      CreateItemRecord  : await CreateItemRecord.countAsync(),
      RemodelItemRecord : await RemodelItemRecord.countAsync(),
      DropShipRecord    : await DropShipRecord.countAsync(),
      SelectRankRecord  : await SelectRankRecord.countAsync(),
      PassEventRecord   : await PassEventRecord.countAsync(),
      Quest             : await Quest.countAsync(),
      BattleAPI         : await BattleAPI.countAsync(),
      AACIRecord        : await AACIRecord.countAsync(),
      NightContactRecord: await NightContactRecord.countAsync(),
    },
  }
  ctx.status = 200
  ctx.body   = ret
  await next()
})

router.post('/api/github-master-hook', async (ctx, next) => {
  const update = childProcess.spawn(config.root + '/github-master-hook', [])
  update.stdout.on('data', (data) =>
    console.log('GitHub hook out: ' + data))
  update.stderr.on('data', (data) =>
    console.log('GitHub hook err: ' + data))
  update.on('close', (code) =>
    console.log('GitHub hook exit: ' + code))
  ctx.status = 200
  ctx.body   = {
    code: 0,
  }
  await next()
})

router.get('/api/latest-commit', async (ctx, next) => {
  ctx.status = 200
  ctx.body = global.latestCommit
  await next()
})

export default (app) => {
  app.use(router.routes())
}
