import { afterEach, describe, expect, test, vi } from 'vitest'
import ChildProcess from 'child_process'
import fs from 'fs'
import { type FastifyInstance } from 'fastify'
import path from 'path'
import { EventEmitter } from 'events'

import { createHookApp, runMasterHook } from '../hooks'

let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
})

describe('poi hook server', () => {
  test('runs the deploy hook for GitHub master hook POSTs', async () => {
    const runHook = vi.fn()
    app = createHookApp({ runHook })

    const response = await app.inject({
      method: 'POST',
      url: '/api/github-master-hook',
    })

    expect(response.statusCode).toBe(200)
    expect(response.body).toBe('')
    expect(runHook).toHaveBeenCalledTimes(1)
  })

  test('returns 404 without running the deploy hook for other requests', async () => {
    const runHook = vi.fn()
    app = createHookApp({ runHook })

    const response = await app.inject('/api/github-master-hook')

    expect(response.statusCode).toBe(404)
    expect(response.body).toBe('not found')
    expect(runHook).not.toHaveBeenCalled()
  })

  test('spawns the deploy script using an absolute path', () => {
    const child = new EventEmitter()
    const spawn = vi.spyOn(ChildProcess, 'spawn').mockReturnValue(child as never)

    runMasterHook()

    expect(spawn).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(`${path.sep === '\\' ? '\\\\' : path.sep}github-master-hook$`),
      ),
      [],
      { stdio: 'inherit' },
    )
    expect(path.isAbsolute(spawn.mock.calls[0][0] as string)).toBe(true)
  })

  test('prepares the selected database before pruning dependencies and restarting', () => {
    const hook = fs.readFileSync(path.resolve(__dirname, '../github-master-hook'), 'utf8')
    const installIndex = hook.indexOf('npm ci')
    const databaseMigrationIndex = hook.indexOf('npm run db:migrate')
    const pruneIndex = hook.indexOf('npm prune --omit=dev')
    const restartIndex = hook.indexOf('supervisorctl start poi')

    expect(installIndex).toBeGreaterThan(-1)
    expect(databaseMigrationIndex).toBeGreaterThan(installIndex)
    expect(pruneIndex).toBeGreaterThan(databaseMigrationIndex)
    expect(restartIndex).toBeGreaterThan(pruneIndex)
  })

  test('logs deploy stages and failure context without shell tracing', () => {
    const hook = fs.readFileSync(path.resolve(__dirname, '../github-master-hook'), 'utf8')

    expect(hook).toContain('trap on_deploy_error ERR')
    expect(hook).toContain('status=failed exit_code=$exit_code elapsed_seconds=$elapsed_seconds')
    expect(hook).toContain('status=succeeded previous_sha=$previous_sha sha=$deployed_sha')
    expect(hook).toContain('deploy_stage="migrate-database"')
    expect(hook).toContain('deploy_stage="restart-application"')
    expect(hook).not.toMatch(/\bset -x\b/)
  })
})
