import bluebird from 'bluebird'
import Router from '@koa/router'
import df from 'df'
import childProcess from 'child_process'
import mongoose from 'mongoose'
import config from '../../config'

const dfAsync = bluebird.promisify(df)
export const router = new Router()

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

router.get('/status', async (ctx, next) => {
  const dsk = await dfAsync()
  const ret = {
    env : process.env.NODE_ENV,
    disk: dsk.filter(e => e.mountpoint == '/'),
    mongo: {
      CreateShipRecord  : await CreateShipRecord.count().exec(),
      CreateItemRecord  : await CreateItemRecord.count().exec(),
      RemodelItemRecord : await RemodelItemRecord.count().exec(),
      DropShipRecord    : await DropShipRecord.count().exec(),
      SelectRankRecord  : await SelectRankRecord.count().exec(),
      PassEventRecord   : await PassEventRecord.count().exec(),
      Quest             : await Quest.count().exec(),
      BattleAPI         : await BattleAPI.count().exec(),
      AACIRecord        : await AACIRecord.count().exec(),
      NightContactRecord: await NightContactRecord.count().exec(),
    },
  }
  ctx.status = 200
  ctx.body   = ret
  await next()
})

router.post('/github-master-hook', async (ctx, next) => {
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

router.get('/latest-commit', async (ctx, next) => {
  ctx.status = 200
  ctx.body = global.latestCommit
  await next()
})

export default (app) => {
  app.use(router.routes())
}
