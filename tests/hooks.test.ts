import { type Server } from 'http'
import net, { type Socket } from 'net'
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
      server.closeIdleConnections?.()
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

  test('returns 400 for malformed request URLs without running the deploy hook', async () => {
    const runHook = vi.fn()
    server = createHookServer({ runHook })
    const baseUrl = await listen(server)

    const socket = await new Promise<Socket>((resolve, reject) => {
      const client = net.connect(Number(new URL(baseUrl).port), '127.0.0.1')
      client.once('connect', () => resolve(client))
      client.once('error', reject)
    })

    const response = await new Promise<string>((resolve) => {
      let data = ''
      socket.on('data', (chunk) => {
        data += chunk.toString()
      })
      socket.on('end', () => resolve(data))
      socket.end('GET http://% HTTP/1.1\r\nHost: invalid\r\nConnection: close\r\n\r\n')
    })

    expect(response).toContain('400')
    expect(response).toContain('bad request')
    expect(runHook).not.toHaveBeenCalled()
  })
})
