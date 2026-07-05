import { afterEach, describe, expect, test, vi } from 'vitest'
import { type FastifyInstance } from 'fastify'

interface HookModule {
  createHookApp: (options?: { runHook?: () => void }) => FastifyInstance
}

const loadHookModule = async (): Promise<HookModule> => {
  const hookPath = '../hooks.js'
  const mod = (await import(hookPath)) as { default?: HookModule } & Partial<HookModule>
  return mod.default ?? (mod as HookModule)
}

let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
})

describe('poi hook server', () => {
  test('runs the deploy hook for GitHub master hook POSTs', async () => {
    const { createHookApp } = await loadHookModule()
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
    const { createHookApp } = await loadHookModule()
    const runHook = vi.fn()
    app = createHookApp({ runHook })

    const response = await app.inject('/api/github-master-hook')

    expect(response.statusCode).toBe(404)
    expect(response.body).toBe('not found')
    expect(runHook).not.toHaveBeenCalled()
  })
})
