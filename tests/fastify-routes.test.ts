import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import { type Quest } from '../src/models'

const sentryMocks = vi.hoisted(() => ({
  finish: vi.fn(),
  setContext: vi.fn(),
  setHttpStatus: vi.fn(),
  setName: vi.fn(),
  setTags: vi.fn(),
  setUser: vi.fn(),
  startInactiveSpan: vi.fn(),
  continueTrace: vi.fn((_headers, callback) => callback()),
  withActiveSpan: vi.fn((_span, callback) => callback()),
  withScope: vi.fn(),
}))

vi.mock('@sentry/node', () => ({
  startInactiveSpan: sentryMocks.startInactiveSpan,
  continueTrace: sentryMocks.continueTrace,
  setHttpStatus: sentryMocks.setHttpStatus,
  withActiveSpan: sentryMocks.withActiveSpan,
  withScope: sentryMocks.withScope,
  captureException: vi.fn(),
}))

const questDistinctMock = vi.hoisted(() => vi.fn())

vi.mock('../src/models', async () => {
  const actual = await vi.importActual('../src/models')
  return {
    ...actual,
    Quest: {
      ...(actual as { Quest: typeof Quest }).Quest,
      distinct: questDistinctMock,
    },
  }
})

import { createApp } from '../src/create-app'
import { cloudflareCacheHeaders } from '../src/http/cache-control'
import { toAppRequest } from '../src/http/fastify'

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
    questDistinctMock.mockReset()
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

  test('sets Cloudflare cache headers without serving stale in-process responses', async () => {
    questDistinctMock
      .mockReturnValueOnce({ exec: vi.fn(async () => ['first']) })
      .mockReturnValueOnce({ exec: vi.fn(async () => ['second']) })
    const app = createApp({ disableLogger: true })

    const firstResponse = await app.inject('/api/report/v3/known_quests')
    const secondResponse = await app.inject('/api/report/v3/known_quests')

    await app.close()

    expect(firstResponse.statusCode).toBe(200)
    expect(secondResponse.statusCode).toBe(200)
    expect(firstResponse.json()).toEqual({ quests: ['first'] })
    expect(secondResponse.json()).toEqual({ quests: ['second'] })
    expect(firstResponse.headers['cache-control']).toBe(cloudflareCacheHeaders['Cache-Control'])
    expect(firstResponse.headers['cdn-cache-control']).toBe(
      cloudflareCacheHeaders['CDN-Cache-Control'],
    )
    expect(secondResponse.headers['cache-control']).toBe(cloudflareCacheHeaders['Cache-Control'])
    expect(secondResponse.headers['cdn-cache-control']).toBe(
      cloudflareCacheHeaders['CDN-Cache-Control'],
    )
    expect(questDistinctMock).toHaveBeenCalledTimes(2)
  })

  test('maps AppRequest path from the concrete URL path', () => {
    const request = {
      body: undefined,
      headers: {},
      method: 'POST',
      params: { id: '1' },
      query: {},
      routeOptions: { url: '/api/report/v2/quest/:id' },
      url: '/api/report/v2/quest/1?debug=1',
    }

    expect(toAppRequest(request as never).path).toBe('/api/report/v2/quest/1')
  })

  test('normalizes repeated query params to Fastify default last-value behavior', () => {
    const request = {
      body: undefined,
      headers: {},
      method: 'GET',
      params: {},
      query: {
        afterId: ['bad', '000000000000000000000000'],
      },
      routeOptions: { url: '/api/report/v3/item_improvement_recipes/availability' },
      url: '/api/report/v3/item_improvement_recipes/availability?afterId=bad&afterId=000000000000000000000000',
    }

    expect(toAppRequest(request as never).query).toEqual({
      afterId: '000000000000000000000000',
    })
  })

  test('uses Cloudflare Ray as request id when explicit request ids are absent', async () => {
    const app = createApp({ disableLogger: true })
    app.get('/request-id', async (request) => ({ id: request.id }))

    const response = await app.inject({
      headers: {
        'cf-ray': 'abc123-NRT',
      },
      url: '/request-id',
    })

    await app.close()

    expect(response.json()).toEqual({ id: 'abc123-NRT' })
  })

  test('logs server errors before returning empty 5xx responses', async () => {
    const app = createApp({ disableLogger: true })
    const errorSpy = vi.spyOn(app.log, 'error')
    app.get('/boom', async () => {
      throw new Error('boom')
    })

    const response = await app.inject('/boom')

    await app.close()

    expect(response.statusCode).toBe(500)
    expect(response.body).toBe('')
    expect(errorSpy).toHaveBeenCalledWith({ err: expect.any(Error) }, 'Unhandled request error')
  })
})
