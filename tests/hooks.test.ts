import { afterEach, describe, expect, test, vi } from 'vitest'
import ChildProcess from 'child_process'
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
})
