import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'

const sentryMocks = vi.hoisted(() => ({
  addEventProcessor: vi.fn(),
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
  withActiveSpan: vi.fn((_span, callback) => callback()),
  withScope: vi.fn(),
}))

vi.mock('@sentry/node', () => ({
  startInactiveSpan: sentryMocks.startInactiveSpan,
  continueTrace: sentryMocks.continueTrace,
  setHttpStatus: sentryMocks.setHttpStatus,
  withActiveSpan: sentryMocks.withActiveSpan,
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
        addEventProcessor: sentryMocks.addEventProcessor,
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
        'cf-connecting-ipv6': '2001:db8::1',
        'cf-connecting-ip': '198.51.100.1',
        'cf-ipcountry': 'JP',
        'cf-pseudo-ipv4': '240.0.2.1',
        'cf-ray': 'abc123-NRT',
        'cf-worker': 'example.com',
        'user-agent': 'fallback-agent',
        'x-forwarded-for': '192.0.2.2',
        'x-real-ip': '192.0.2.1',
        'x-reporter': 'Reporter/8.1.0',
      },
    )

    expect(response.statusCode).toBe(200)
    expect(sentryMocks.setName).toHaveBeenCalledWith('POST /api/report/v3/quest')
    expect(sentryMocks.setHttpStatus).toHaveBeenCalledWith(expect.anything(), 200)
    expect(sentryMocks.withActiveSpan).toHaveBeenCalledWith(
      expect.objectContaining({
        end: sentryMocks.finish,
        updateName: sentryMocks.setName,
      }),
      expect.any(Function),
    )
    expect(sentryMocks.setUser).toHaveBeenCalledWith({ ip_address: '2001:db8::1' })
    expect(sentryMocks.setTags).toHaveBeenCalledWith(
      expect.objectContaining({
        cf_connecting_ipv6: '2001:db8::1',
        cf_country: 'JP',
        cf_pseudo_ipv4: '240.0.2.1',
        cf_ray: 'abc123-NRT',
        cf_worker: 'example.com',
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
        authorization: 'Bearer secret',
        'cf-connecting-ipv6': '2001:db8::1',
        'cf-connecting-ip': '198.51.100.1',
        'cf-ipcountry': 'JP',
        'cf-pseudo-ipv4': '240.0.2.1',
        'cf-ray': 'abc123-NRT',
        'cf-worker': 'example.com',
        cookie: 'session=secret',
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
        cf_connecting_ipv6: '2001:db8::1',
        cf_country: 'JP',
        cf_pseudo_ipv4: '240.0.2.1',
        cf_ray: 'abc123-NRT',
        cf_worker: 'example.com',
        reporter: 'Reporter/8.1.0',
        url: '/api/report/v3/quest?debug=1',
      }),
    )
    expect(sentryMocks.setContext).toHaveBeenCalledWith('data', { questId: 1 })
    const processor = sentryMocks.addEventProcessor.mock.calls[0][0]
    expect(
      processor({
        request: {
          headers: {
            existing: 'header',
          },
        },
      }),
    ).toEqual({
      request: {
        data: { questId: 1 },
        headers: expect.objectContaining({
          existing: 'header',
          'cf-ray': 'abc123-NRT',
          'x-reporter': 'Reporter/8.1.0',
        }),
        method: 'POST',
        query_string: '',
        url: '/api/report/v3/quest?debug=1',
      },
    })
    expect(processor({}).request.headers).not.toHaveProperty('authorization')
    expect(processor({}).request.headers).not.toHaveProperty('cookie')
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

  test('decorates Fastify requests before assigning Sentry spans', async () => {
    const app = Fastify({ logger: false })
    registerSentryHooks(app)
    app.get('/decorated', async (request) => ({
      hasSentrySpan: Object.prototype.hasOwnProperty.call(request, 'sentrySpan'),
    }))

    const response = await app.inject('/decorated')

    await app.close()

    expect(response.json()).toEqual({ hasSentrySpan: true })
  })
})
