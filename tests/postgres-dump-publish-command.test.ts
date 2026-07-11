import { describe, expect, test, vi } from 'vitest'

import { type DumpPool } from '../src/db/postgres/dumps/adapter'
import { type DumpRunRow } from '../src/db/postgres/dumps/dump-run-repository'
import { publishDumpMonth } from '../src/db/postgres/dumps/publish-dump-month'
import { createDumpPoolFromPgPool } from '../src/db/postgres/dumps/pg-query-stream-adapter'
import { createOfflineDumpPool } from '../src/db/postgres/client'
import {
  defaultPublishDumpMonthCommandDeps,
  publishDumpMonthCommandUsage,
  runPublishDumpMonthCommand,
  type PublishDumpMonthCommandDeps,
} from '../src/cli/postgres-dump-publish-command'
import { loadR2ObjectStoreConfigFromEnv } from '../src/object-store/r2-object-store'

const fakeR2Env = {
  POI_SERVER_DUMP_R2_ENDPOINT: 'https://account-id.r2.cloudflarestorage.com',
  POI_SERVER_DUMP_R2_BUCKET: 'community-dumps',
  POI_SERVER_DUMP_R2_ACCESS_KEY_ID: 'the-access-key-id',
  POI_SERVER_DUMP_R2_SECRET_ACCESS_KEY: 'the-super-secret-value',
}

const fakeRun: DumpRunRow = {
  id: 7,
  dumpMonth: '2098-05',
  schemaVersion: 1,
  status: 'published',
  manifestObjectKey: 'manifest-key',
  manifestBytes: 10,
  manifestSha256: 'abc',
  publishedAt: new Date('2098-06-01T00:00:00.000Z'),
  cleanupEligibleAt: null,
  cleanedAt: null,
  error: null,
}

const makeFakeDeps = (
  overrides: Partial<PublishDumpMonthCommandDeps> = {},
): {
  deps: PublishDumpMonthCommandDeps
  calls: Record<string, unknown[]>
  pool: { end: ReturnType<typeof vi.fn> }
} => {
  const calls: Record<string, unknown[]> = {
    resolveDatabaseUrl: [],
    resolveDatabaseBackend: [],
    loadR2Config: [],
    createObjectStore: [],
    createOfflineDumpPool: [],
    createDumpPoolFromPgPool: [],
    publishDumpMonth: [],
    endPool: [],
  }
  const fakePool = { end: vi.fn() }
  const fakeDumpPool: DumpPool = { connect: vi.fn() }
  const fakeObjectStore = { putIfAbsent: vi.fn(), getObject: vi.fn() }

  const deps: PublishDumpMonthCommandDeps = {
    resolveDatabaseUrl: (env) => {
      calls.resolveDatabaseUrl.push(env)
      return 'postgresql://user:the-db-password@localhost:5432/poi'
    },
    resolveDatabaseBackend: (databaseUrl) => {
      calls.resolveDatabaseBackend.push(databaseUrl)
      return 'postgresql'
    },
    loadR2Config: (env) => {
      calls.loadR2Config.push(env)
      return loadR2ObjectStoreConfigFromEnv(fakeR2Env)
    },
    createObjectStore: (config) => {
      calls.createObjectStore.push(config)
      return fakeObjectStore
    },
    createOfflineDumpPool: (databaseUrl) => {
      calls.createOfflineDumpPool.push(databaseUrl)
      return fakePool as never
    },
    createDumpPoolFromPgPool: (pool) => {
      calls.createDumpPoolFromPgPool.push(pool)
      return fakeDumpPool
    },
    endPool: async (pool) => {
      calls.endPool.push(pool)
      await (pool as { end: () => Promise<void> }).end()
    },
    publishDumpMonth: async (pool, store, month) => {
      calls.publishDumpMonth.push([pool, store, month])
      return fakeRun
    },
    ...overrides,
  }

  return { deps, calls, pool: fakePool }
}

describe('runPublishDumpMonthCommand', () => {
  test('rejects a missing argument without touching any dependency', async () => {
    const { deps, calls } = makeFakeDeps()

    await expect(runPublishDumpMonthCommand([], {}, deps)).rejects.toThrow(/Usage/)

    expect(calls.resolveDatabaseUrl).toHaveLength(0)
    expect(calls.loadR2Config).toHaveLength(0)
    expect(calls.createOfflineDumpPool).toHaveLength(0)
  })

  test('rejects a malformed Dump Month without touching any dependency', async () => {
    const { deps, calls } = makeFakeDeps()

    await expect(runPublishDumpMonthCommand(['2098-5'], {}, deps)).rejects.toThrow(/YYYY-MM/)
    await expect(runPublishDumpMonthCommand(['not-a-month'], {}, deps)).rejects.toThrow(/YYYY-MM/)
    await expect(runPublishDumpMonthCommand(['2098-13'], {}, deps)).rejects.toThrow(/YYYY-MM/)

    expect(calls.resolveDatabaseUrl).toHaveLength(0)
    expect(calls.loadR2Config).toHaveLength(0)
    expect(calls.createOfflineDumpPool).toHaveLength(0)
  })

  test('rejects extra arguments without touching any dependency', async () => {
    const { deps, calls } = makeFakeDeps()

    await expect(runPublishDumpMonthCommand(['2098-05', 'extra'], {}, deps)).rejects.toThrow(
      /Usage/,
    )

    expect(calls.resolveDatabaseUrl).toHaveLength(0)
  })

  test('requires a PostgreSQL backend before loading R2 config or connecting', async () => {
    const { deps, calls } = makeFakeDeps({
      resolveDatabaseBackend: () => {
        calls.resolveDatabaseBackend.push('mongodb')
        return 'mongodb'
      },
    })

    await expect(runPublishDumpMonthCommand(['2098-05'], {}, deps)).rejects.toThrow(
      /requires a postgres: or postgresql: database URL/,
    )

    expect(calls.loadR2Config).toHaveLength(0)
    expect(calls.createOfflineDumpPool).toHaveLength(0)
  })

  test('on success: loads R2 config, wires the offline pool, calls publishDumpMonth, ends the pool, and returns its result', async () => {
    const { deps, calls, pool } = makeFakeDeps()

    const result = await runPublishDumpMonthCommand(['2098-05'], {}, deps)

    expect(result).toBe(fakeRun)
    expect(calls.loadR2Config).toHaveLength(1)
    expect(calls.createOfflineDumpPool).toEqual([
      'postgresql://user:the-db-password@localhost:5432/poi',
    ])
    expect(calls.createDumpPoolFromPgPool).toEqual([pool])
    const publishCall = calls.publishDumpMonth[0] as [unknown, unknown, string]
    expect(publishCall[2]).toBe('2098-05')
    expect(pool.end).toHaveBeenCalledOnce()
  })

  test('ends the pool even when publishDumpMonth throws', async () => {
    const { deps, pool } = makeFakeDeps({
      publishDumpMonth: async () => {
        throw new Error('export failed')
      },
    })

    await expect(runPublishDumpMonthCommand(['2098-05'], {}, deps)).rejects.toThrow('export failed')
    expect(pool.end).toHaveBeenCalledOnce()
  })

  test('redacts the database password and R2 secrets from a thrown error message', async () => {
    const { deps } = makeFakeDeps({
      publishDumpMonth: async () => {
        throw new Error(
          'boom while talking to postgresql://user:the-db-password@localhost/poi and ' +
            'R2 key the-access-key-id / secret the-super-secret-value',
        )
      },
    })

    let thrown: Error | undefined
    try {
      await runPublishDumpMonthCommand(['2098-05'], {}, deps)
    } catch (error) {
      thrown = error as Error
    }

    expect(thrown).toBeDefined()
    expect(thrown?.message).not.toContain('the-db-password')
    expect(thrown?.message).not.toContain('the-access-key-id')
    expect(thrown?.message).not.toContain('the-super-secret-value')
    expect(thrown?.message).toContain('<redacted>')
  })
})

describe('defaultPublishDumpMonthCommandDeps', () => {
  test('wires the real production functions', () => {
    expect(defaultPublishDumpMonthCommandDeps.publishDumpMonth).toBe(publishDumpMonth)
    expect(defaultPublishDumpMonthCommandDeps.loadR2Config).toBe(loadR2ObjectStoreConfigFromEnv)
    expect(defaultPublishDumpMonthCommandDeps.createDumpPoolFromPgPool).toBe(
      createDumpPoolFromPgPool,
    )
  })

  test('createOfflineDumpPool delegates to the real client factory', () => {
    const pool = defaultPublishDumpMonthCommandDeps.createOfflineDumpPool(
      'postgresql://localhost/poi',
    )
    try {
      expect(pool.options.max).toBe(createOfflineDumpPool('postgresql://localhost/poi').options.max)
    } finally {
      void pool.end()
    }
  })
})

test('publishDumpMonthCommandUsage documents the expected argv shape', () => {
  expect(publishDumpMonthCommandUsage).toContain('YYYY-MM')
})
