import { describe, expect, test, vi, beforeEach } from 'vitest'

const sentryMocks = vi.hoisted(() => ({
  finish: vi.fn(),
  setContext: vi.fn(),
  setHttpStatus: vi.fn(),
  setName: vi.fn(),
  setTags: vi.fn(),
  setUser: vi.fn(),
  startTransaction: vi.fn(),
  withScope: vi.fn(),
}))

vi.mock('@sentry/node', () => ({
  startTransaction: sentryMocks.startTransaction,
  withScope: sentryMocks.withScope,
  captureException: vi.fn(),
  Handlers: {
    parseRequest: vi.fn((event) => event),
  },
}))

vi.mock('@sentry/tracing', () => ({
  extractTraceparentData: vi.fn(),
  stripUrlQueryAndFragment: vi.fn((url: string) => url.split('?')[0]),
}))

import { sentryTracingMiddileaware } from '../src/sentry'

const createContext = (data: unknown) =>
  ({
    headers: {},
    method: 'POST',
    mountPath: '/api/report/v3',
    path: '/quest',
    request: {
      body: {
        data,
      },
      get: () => '',
      url: '/api/report/v3/quest',
    },
    status: 200,
    url: '/api/report/v3/quest?debug=1',
  }) as never

describe('sentry tracing middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sentryMocks.startTransaction.mockReturnValue({
      finish: sentryMocks.finish,
      setHttpStatus: sentryMocks.setHttpStatus,
      setName: sentryMocks.setName,
    })
    sentryMocks.withScope.mockImplementation((callback) =>
      callback({
        setContext: sentryMocks.setContext,
        setTags: sentryMocks.setTags,
        setUser: sentryMocks.setUser,
      }),
    )
  })

  test('wraps non-object request body data in Sentry context', async () => {
    await sentryTracingMiddileaware(createContext('{"questId":1}'), async () => undefined)

    expect(sentryMocks.setContext).toHaveBeenCalledWith('data', {
      data: '{"questId":1}',
    })
  })

  test('wraps array request body data in Sentry context', async () => {
    await sentryTracingMiddileaware(createContext([{ questId: 1 }]), async () => undefined)

    expect(sentryMocks.setContext).toHaveBeenCalledWith('data', {
      data: [{ questId: 1 }],
    })
  })

  test('keeps object request body data as Sentry context', async () => {
    await sentryTracingMiddileaware(createContext({ questId: 1 }), async () => undefined)

    expect(sentryMocks.setContext).toHaveBeenCalledWith('data', {
      questId: 1,
    })
  })
})
