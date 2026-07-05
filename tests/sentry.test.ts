import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'

const sentryMocks = vi.hoisted(() => ({
  captureException: vi.fn(),
  finish: vi.fn(),
  parseRequest: vi.fn((event) => event),
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
  captureException: sentryMocks.captureException,
}))

import Fastify from 'fastify'

import { captureException, registerSentryHooks } from '../src/sentry'

const injectSentryRequest = async (data: unknown, headers: Record<string, string> = {}) => {
  const app = Fastify({ logger: false })
  registerSentryHooks(app)
  app.post('/api/report/v3/quest', async () => ({ ok: true }))

  const response = await app.inject({
    headers,
    method: 'POST',
    payload: { data },
    url: '/api/report/v3/quest?debug=1',
  })
  await app.close()
  return response
}

describe('sentry tracing hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sentryMocks.startInactiveSpan.mockReturnValue({
      end: sentryMocks.finish,
      updateName: sentryMocks.setName,
    })
    sentryMocks.withScope.mockImplementation((callback) =>
      callback({
        addEventProcessor: vi.fn(),
        setContext: sentryMocks.setContext,
        setTags: sentryMocks.setTags,
        setUser: sentryMocks.setUser,
      }),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('wraps non-object request body data in Sentry context', async () => {
    await injectSentryRequest('{"questId":1}')

    expect(sentryMocks.setContext).toHaveBeenCalledWith('data', {
      data: '{"questId":1}',
    })
  })

  test('wraps array request body data in Sentry context', async () => {
    await injectSentryRequest([{ questId: 1 }])

    expect(sentryMocks.setContext).toHaveBeenCalledWith('data', {
      data: [{ questId: 1 }],
    })
  })

  test('keeps object request body data as Sentry context', async () => {
    await injectSentryRequest({ questId: 1 })

    expect(sentryMocks.setContext).toHaveBeenCalledWith('data', {
      questId: 1,
    })
  })

  test('preserves request metadata on transaction completion', async () => {
    const response = await injectSentryRequest(
      { questId: 1 },
      {
        'user-agent': 'fallback-agent',
        'x-forwarded-for': '192.0.2.2',
        'x-real-ip': '192.0.2.1',
        'x-reporter': 'Reporter/8.1.0',
      },
    )

    expect(response.statusCode).toBe(200)
    expect(sentryMocks.setName).toHaveBeenCalledWith('POST /api/report/v3/quest')
    expect(sentryMocks.setHttpStatus).toHaveBeenCalledWith(expect.anything(), 200)
    expect(sentryMocks.setUser).toHaveBeenCalledWith({ ip_address: '192.0.2.1' })
    expect(sentryMocks.setTags).toHaveBeenCalledWith(
      expect.objectContaining({
        reporter: 'Reporter/8.1.0',
        url: '/api/report/v3/quest?debug=1',
      }),
    )
  })

  test('adds request url and body data context when capturing exceptions', () => {
    const err = new Error('boom')

    captureException(err, {
      body: {
        data: { questId: 1 },
      },
      headers: {
        'x-reporter': 'Reporter/8.1.0',
      },
      method: 'POST',
      params: {},
      path: '/api/report/v3/quest',
      query: {},
      url: '/api/report/v3/quest?debug=1',
    })

    expect(sentryMocks.setTags).toHaveBeenCalledWith(
      expect.objectContaining({
        reporter: 'Reporter/8.1.0',
        url: '/api/report/v3/quest?debug=1',
      }),
    )
    expect(sentryMocks.setContext).toHaveBeenCalledWith('data', { questId: 1 })
    expect(sentryMocks.captureException).toHaveBeenCalledWith(err)
  })

  test('captures unhandled route errors exactly once and still finishes the span', async () => {
    const app = Fastify({ logger: false })
    registerSentryHooks(app)
    app.setErrorHandler((_err, _request, reply) => reply.code(500).send())
    app.get('/boom', async () => {
      throw new Error('boom')
    })

    const response = await app.inject('/boom')

    await app.close()

    expect(response.statusCode).toBe(500)
    expect(sentryMocks.captureException).toHaveBeenCalledTimes(1)
    expect(sentryMocks.finish).toHaveBeenCalledTimes(1)
  })
})
