import { afterEach, describe, expect, test, vi } from 'vitest'

const sentryMocks = vi.hoisted(() => ({
  init: vi.fn(),
  mongoIntegration: vi.fn(() => 'mongoIntegration'),
}))

vi.mock('@sentry/node', () => ({
  init: sentryMocks.init,
  mongoIntegration: sentryMocks.mongoIntegration,
}))

describe('sentry bootstrap', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    vi.unstubAllEnvs()
    sentryMocks.init.mockReset()
    sentryMocks.mongoIntegration.mockClear()
  })

  test('enables MongoDB integration for MongoDB URLs', async () => {
    vi.stubEnv('POI_SERVER_DATABASE_URL', 'mongodb://localhost:27017/poi')

    const { initSentry } = await import('../src/sentry-bootstrap')

    initSentry()

    expect(sentryMocks.mongoIntegration).toHaveBeenCalledTimes(1)
    expect(sentryMocks.init).toHaveBeenCalledWith(
      expect.objectContaining({
        integrations: ['mongoIntegration'],
      }),
    )
  })

  test('disables MongoDB integration for PostgreSQL URLs', async () => {
    vi.stubEnv('POI_SERVER_DATABASE_URL', 'postgresql://localhost:5432/poi')

    const { initSentry } = await import('../src/sentry-bootstrap')

    initSentry()

    expect(sentryMocks.mongoIntegration).not.toHaveBeenCalled()
    expect(sentryMocks.init).toHaveBeenCalledWith(
      expect.objectContaining({
        integrations: [],
      }),
    )
  })
})
