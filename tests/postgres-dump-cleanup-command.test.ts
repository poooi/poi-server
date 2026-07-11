import { describe, expect, test, vi } from 'vitest'

import { type DumpPool } from '../src/db/postgres/dumps/adapter'
import {
  cleanupDumpRun,
  type CleanupDumpRunResult,
} from '../src/db/postgres/dumps/cleanup-dump-run'
import { createDumpPoolFromPgPool } from '../src/db/postgres/dumps/pg-query-stream-adapter'
import {
  cleanupDumpRunCommandUsage,
  defaultCleanupDumpRunCommandDeps,
  parseCleanupRunIdArg,
  runCleanupDumpRunCommand,
  type CleanupDumpRunCommandDeps,
} from '../src/cli/postgres-dump-cleanup-command'
import { loadR2ObjectStoreConfigFromEnv } from '../src/object-store/r2-object-store'

const fakeR2Env = {
  POI_SERVER_DUMP_R2_ENDPOINT: 'https://account-id.r2.cloudflarestorage.com',
  POI_SERVER_DUMP_R2_BUCKET: 'community-dumps',
  POI_SERVER_DUMP_R2_ACCESS_KEY_ID: 'the-access-key-id',
  POI_SERVER_DUMP_R2_SECRET_ACCESS_KEY: 'the-super-secret-value',
}

const fakeCleanupResult: CleanupDumpRunResult = {
  runId: 7,
  action: 'cleaned',
  partitionsDropped: ['observations_2098_05'],
}

const makeFakeDeps = (
  overrides: Partial<CleanupDumpRunCommandDeps> = {},
): {
  deps: CleanupDumpRunCommandDeps
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
    cleanupDumpRun: [],
    endPool: [],
  }
  const fakePool = { end: vi.fn() }
  const fakeDumpPool: DumpPool = { connect: vi.fn() }
  const fakeObjectStore = { putIfAbsent: vi.fn(), getObject: vi.fn() }

  const deps: CleanupDumpRunCommandDeps = {
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
    cleanupDumpRun: async (pool, store, runId) => {
      calls.cleanupDumpRun.push([pool, store, runId])
      return fakeCleanupResult
    },
    ...overrides,
  }

  return { deps, calls, pool: fakePool }
}

describe('parseCleanupRunIdArg', () => {
  test('accepts a positive integer', () => {
    expect(parseCleanupRunIdArg('1')).toBe(1)
    expect(parseCleanupRunIdArg('42')).toBe(42)
  })

  test.each(['0', '-1', '1.5', '1e3', ' 1', '1 ', '007', 'abc', ''])('rejects %j', (value) => {
    expect(() => parseCleanupRunIdArg(value)).toThrow()
  })
})

describe('runCleanupDumpRunCommand', () => {
  test('rejects a missing argument without touching any dependency', async () => {
    const { deps, calls } = makeFakeDeps()

    await expect(runCleanupDumpRunCommand([], {}, deps)).rejects.toThrow(/Usage/)

    expect(calls.resolveDatabaseUrl).toHaveLength(0)
    expect(calls.loadR2Config).toHaveLength(0)
    expect(calls.createOfflineDumpPool).toHaveLength(0)
  })

  test.each(['0', '-1', '1.5', 'abc', '007'])(
    'rejects invalid run id %j without touching any dependency',
    async (value) => {
      const { deps, calls } = makeFakeDeps()

      await expect(runCleanupDumpRunCommand([value], {}, deps)).rejects.toThrow()

      expect(calls.resolveDatabaseUrl).toHaveLength(0)
      expect(calls.loadR2Config).toHaveLength(0)
      expect(calls.createOfflineDumpPool).toHaveLength(0)
    },
  )

  test('requires a PostgreSQL backend before loading R2 config or connecting', async () => {
    const { deps, calls } = makeFakeDeps({
      resolveDatabaseBackend: () => {
        calls.resolveDatabaseBackend.push('mongodb')
        return 'mongodb'
      },
    })

    await expect(runCleanupDumpRunCommand(['7'], {}, deps)).rejects.toThrow(
      /requires a postgres: or postgresql: database URL/,
    )

    expect(calls.loadR2Config).toHaveLength(0)
    expect(calls.createOfflineDumpPool).toHaveLength(0)
  })

  test('on success: loads R2 config, wires the offline pool, calls cleanupDumpRun, ends the pool, and returns its result', async () => {
    const { deps, calls, pool } = makeFakeDeps()

    const result = await runCleanupDumpRunCommand(['7'], {}, deps)

    expect(result).toBe(fakeCleanupResult)
    expect(calls.loadR2Config).toHaveLength(1)
    expect(calls.createOfflineDumpPool).toEqual([
      'postgresql://user:the-db-password@localhost:5432/poi',
    ])
    expect(calls.createDumpPoolFromPgPool).toEqual([pool])
    const cleanupCall = calls.cleanupDumpRun[0] as [unknown, unknown, number]
    expect(cleanupCall[2]).toBe(7)
    expect(pool.end).toHaveBeenCalledOnce()
  })

  test('ends the pool even when cleanupDumpRun throws', async () => {
    const { deps, pool } = makeFakeDeps({
      cleanupDumpRun: async () => {
        throw new Error('cleanup failed')
      },
    })

    await expect(runCleanupDumpRunCommand(['7'], {}, deps)).rejects.toThrow('cleanup failed')
    expect(pool.end).toHaveBeenCalledOnce()
  })

  test('redacts the database password and R2 secrets from a thrown error message', async () => {
    const { deps } = makeFakeDeps({
      cleanupDumpRun: async () => {
        throw new Error(
          'boom while talking to postgresql://user:the-db-password@localhost/poi and ' +
            'R2 key the-access-key-id / secret the-super-secret-value',
        )
      },
    })

    let thrown: Error | undefined
    try {
      await runCleanupDumpRunCommand(['7'], {}, deps)
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

describe('defaultCleanupDumpRunCommandDeps', () => {
  test('wires the real production functions', () => {
    expect(defaultCleanupDumpRunCommandDeps.cleanupDumpRun).toBe(cleanupDumpRun)
    expect(defaultCleanupDumpRunCommandDeps.loadR2Config).toBe(loadR2ObjectStoreConfigFromEnv)
    expect(defaultCleanupDumpRunCommandDeps.createDumpPoolFromPgPool).toBe(createDumpPoolFromPgPool)
  })
})

test('cleanupDumpRunCommandUsage documents the expected argv shape', () => {
  expect(cleanupDumpRunCommandUsage).toContain('data_dump_runs.id')
})
