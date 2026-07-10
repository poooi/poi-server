import df from '@sindresorhus/df'
import childProcess from 'child_process'
import mongoose from 'mongoose'
import { makeBadge } from 'badge-maker'
import path from 'path'

import { config } from '../../config'
import { type DatabaseBackend } from '../../db/backend'
import { getAppendOnlySqliteCounts } from '../../db/sqlite/append-only'
import { getOperationalSqliteCounts } from '../../db/sqlite/operational'
import { ok, type AppResult } from '../../http/result'

const CreateShipRecord = mongoose.model('CreateShipRecord')
const CreateItemRecord = mongoose.model('CreateItemRecord')
const RemodelItemRecord = mongoose.model('RemodelItemRecord')
const DropShipRecord = mongoose.model('DropShipRecord')
const SelectRankRecord = mongoose.model('SelectRankRecord')
const PassEventRecord = mongoose.model('PassEventRecord')
const Quest = mongoose.model('Quest')
const BattleAPI = mongoose.model('BattleAPI')
const AACIRecord = mongoose.model('AACIRecord')
const NightContactRecord = mongoose.model('NightContactRecord')

export const getStatus = async (backend: DatabaseBackend = 'mongo'): Promise<AppResult> => {
  const dsk = await df()
  if (backend === 'sqlite') {
    return ok({
      env: process.env.NODE_ENV,
      disk: dsk.filter((e) => e.mountpoint == '/'),
      sqlite: {
        ...getAppendOnlySqliteCounts(),
        ...getOperationalSqliteCounts(),
      },
    })
  }

  return ok({
    env: process.env.NODE_ENV,
    disk: dsk.filter((e) => e.mountpoint == '/'),
    mongo: {
      CreateShipRecord: await CreateShipRecord.count().exec(),
      CreateItemRecord: await CreateItemRecord.count().exec(),
      RemodelItemRecord: await RemodelItemRecord.count().exec(),
      DropShipRecord: await DropShipRecord.count().exec(),
      SelectRankRecord: await SelectRankRecord.count().exec(),
      PassEventRecord: await PassEventRecord.count().exec(),
      Quest: await Quest.count().exec(),
      BattleAPI: await BattleAPI.count().exec(),
      AACIRecord: await AACIRecord.count().exec(),
      NightContactRecord: await NightContactRecord.count().exec(),
    },
  })
}

export const runGithubMasterHook = async (): Promise<AppResult> => {
  const update = childProcess.spawn(path.resolve(config.root, '../github-master-hook'), [])
  update.stdout.on('data', (data) => console.log('GitHub hook out: ' + data))
  update.stderr.on('data', (data) => console.log('GitHub hook err: ' + data))
  update.on('close', (code) => console.log('GitHub hook exit: ' + code))
  return ok({ code: 0 })
}

export const getLatestCommit = async (): Promise<AppResult> => ok(global.latestCommit)

let serviceUpBadge: string

export const getServiceStatusBadge = async (): Promise<AppResult> => {
  if (!serviceUpBadge) {
    serviceUpBadge = makeBadge({
      label: 'service',
      message: 'up',
      color: 'success',
      style: 'flat-square',
    })
  }

  return ok(serviceUpBadge)
}

let serviceVersionBadge: string

export const getServiceVersionBadge = async (): Promise<AppResult> => {
  if (!serviceVersionBadge) {
    serviceVersionBadge = makeBadge({
      label: 'version',
      message: global.latestCommit?.slice(0, 8) || '',
      color: 'informational',
      style: 'flat-square',
    })
  }

  return ok(serviceVersionBadge)
}

export const svgHeaders = {
  'Content-Type': 'image/svg+xml',
}
