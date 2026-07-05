import { type Server } from 'http'
import { createRequire } from 'module'
import { afterEach, describe, expect, test, vi } from 'vitest'

const requireHook = createRequire(__filename)

const { createHookServer } = requireHook('../hooks.js') as {
  createHookServer: (options?: { runHook?: () => void }) => Server
}

let server: Server | undefined

const listen = async (target: Server): Promise<string> =>
  new Promise((resolve, reject) => {
    target.once('error', reject)
    target.listen(0, '127.0.0.1', () => {
      target.off('error', reject)
      const address = target.address()
      if (address == null || typeof address === 'string') {
        reject(new Error('Hook test server did not bind to a TCP port'))
        return
      }
      resolve(`http://127.0.0.1:${address.port}`)
    })
  })

afterEach(
  () =>
    new Promise<void>((resolve, reject) => {
      if (server == null || !server.listening) {
        server = undefined
        resolve()
        return
      }
      server.close((err) => {
        server = undefined
        if (err != null) {
          reject(err)
          return
        }
        resolve()
      })
    }),
)

describe('poi hook server', () => {
  test('runs the deploy hook for GitHub master hook POSTs', async () => {
    const runHook = vi.fn()
    server = createHookServer({ runHook })
    const baseUrl = await listen(server)

    const response = await fetch(`${baseUrl}/api/github-master-hook`, { method: 'POST' })

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('ok')
    expect(runHook).toHaveBeenCalledTimes(1)
  })

  test('returns 404 without running the deploy hook for other requests', async () => {
    const runHook = vi.fn()
    server = createHookServer({ runHook })
    const baseUrl = await listen(server)

    const response = await fetch(`${baseUrl}/api/github-master-hook`)

    expect(response.status).toBe(404)
    expect(await response.text()).toBe('not found')
    expect(runHook).not.toHaveBeenCalled()
  })
})
