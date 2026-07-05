import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'

const sentryMocks = vi.hoisted(() => ({
  finish: vi.fn(),
  setContext: vi.fn(),
  setHttpStatus: vi.fn(),
  setName: vi.fn(),
  setTags: vi.fn(),
  setUser: vi.fn(),
  startInactiveSpan: vi.fn(),
  continueTrace: vi.fn((_headers, callback) => callback()),
  withScope: vi.fn(),
}))

vi.mock('@sentry/node', () => ({
  startInactiveSpan: sentryMocks.startInactiveSpan,
  continueTrace: sentryMocks.continueTrace,
  setHttpStatus: sentryMocks.setHttpStatus,
  withScope: sentryMocks.withScope,
  captureException: vi.fn(),
}))

import { createApp } from '../src/create-app'

describe('Fastify route adapters', () => {
  beforeEach(() => {
    sentryMocks.startInactiveSpan.mockReturnValue({
      end: sentryMocks.finish,
      updateName: sentryMocks.setName,
    })
    sentryMocks.withScope.mockImplementation((callback) =>
      callback({
        setContext: sentryMocks.setContext,
        setTags: sentryMocks.setTags,
        setUser: sentryMocks.setUser,
      }),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('registers common routes with preserved status and headers', async () => {
    const app = createApp({ disableLogger: true })

    const notFoundResponse = await app.inject('/api/not-found')
    const unsupportedMethodResponse = await app.inject({
      method: 'PUT',
      url: '/api/status',
    })
    const statusBadgeResponse = await app.inject('/api/service-status-badge')

    await app.close()

    expect(notFoundResponse.statusCode).toBe(404)
    expect(unsupportedMethodResponse.statusCode).toBe(404)
    expect(statusBadgeResponse.statusCode).toBe(200)
    expect(statusBadgeResponse.headers['content-type']).toContain('image/svg+xml')
    expect(statusBadgeResponse.body).toContain('service')
  })

  test('passes JSON bodies and headers to report handlers', async () => {
    const app = createApp({ disableLogger: true })

    const response = await app.inject({
      headers: {
        'content-type': 'application/json',
        'x-reporter': 'Reporter/8.1.0',
      },
      method: 'POST',
      payload: {
        data: '{',
      },
      url: '/api/report/v2/create_ship',
    })

    await app.close()

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'data must be valid JSON' })
  })

  test('keeps Fastify client parse errors as 4xx responses', async () => {
    const app = createApp({ disableLogger: true })

    const response = await app.inject({
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
      payload: '{',
      url: '/api/report/v2/create_ship',
    })

    await app.close()

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({
      error: "Body is not valid JSON but content-type is set to 'application/json'",
    })
  })

  test('passes repeated query params to cursor parsing', async () => {
    const app = createApp({ disableLogger: true })

    const response = await app.inject(
      '/api/report/v3/item_improvement_recipes/availability?afterId=bad&afterId=ignored',
    )

    await app.close()

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'afterId: must be a valid ObjectId' })
  })
})
