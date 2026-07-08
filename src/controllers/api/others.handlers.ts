import df from '@sindresorhus/df'
import childProcess from 'child_process'
import { makeBadge } from 'badge-maker'
import path from 'path'

import { config } from '../../config'
import { resolveBackend } from '../../db/backend'
import { ok, type AppResult } from '../../http/result'
import { getOtherActions } from './others.actions'

// TODO(postgres): inject backend selection through route registration once multiple backends are wired.
const actions = getOtherActions(resolveBackend(config.db))

export const getStatus = async (): Promise<AppResult> => {
  const dsk = await df()
  return ok({
    env: process.env.NODE_ENV,
    disk: dsk.filter((e) => e.mountpoint == '/'),
    mongo: await actions.getStatus(),
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
