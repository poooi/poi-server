import { beforeEach, describe, expect, test, vi } from 'vitest'

const sentryMocks = vi.hoisted(() => ({
  init: vi.fn(),
  mongoIntegration: vi.fn(() => ({ name: 'mongo' })),
  postgresIntegration: vi.fn(() => ({ name: 'postgres' })),
}))

vi.mock('@sentry/node', () => sentryMocks)

import { initSentry } from '../src/sentry-bootstrap'

describe('Sentry database instrumentation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('enables only MongoDB instrumentation for a MongoDB backend', () => {
    initSentry('mongodb://localhost/poi')

    expect(sentryMocks.mongoIntegration).toHaveBeenCalledOnce()
    expect(sentryMocks.postgresIntegration).not.toHaveBeenCalled()
    expect(sentryMocks.init).toHaveBeenCalledWith(
      expect.objectContaining({
        initialScope: { tags: { database_backend: 'mongodb' } },
        integrations: [{ name: 'mongo' }],
      }),
    )
  })

  test('enables only node-postgres instrumentation for a PostgreSQL backend', () => {
    initSentry('postgresql://localhost/poi')

    expect(sentryMocks.postgresIntegration).toHaveBeenCalledOnce()
    expect(sentryMocks.mongoIntegration).not.toHaveBeenCalled()
    expect(sentryMocks.init).toHaveBeenCalledWith(
      expect.objectContaining({
        initialScope: { tags: { database_backend: 'postgresql' } },
        integrations: [{ name: 'postgres' }],
      }),
    )
  })
})
