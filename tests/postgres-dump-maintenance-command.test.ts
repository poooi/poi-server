import { describe, expect, test, vi } from 'vitest'

import {
  defaultDumpMaintenanceCommandDeps,
  dumpMaintenanceCommandUsage,
  runDumpMaintenanceCommand,
  type DumpMaintenanceCommandDeps,
} from '../src/cli/postgres-dump-maintenance-command'
import { type CleanupDumpRunResult } from '../src/db/postgres/dumps/cleanup-dump-run'
import { type DumpPool } from '../src/db/postgres/dumps/adapter'
import { type DumpRunRow } from '../src/db/postgres/dumps/dump-run-repository'
import { type PartitionPoolClient } from '../src/db/postgres/partitions/adapter'
import { loadR2ObjectStoreConfigFromEnv } from '../src/object-store/r2-object-store'

const fakeR2Env = {
  POI_SERVER_DUMP_R2_ENDPOINT: 'https://account-id.r2.cloudflarestorage.com',
  POI_SERVER_DUMP_R2_BUCKET: 'community-dumps',
  POI_SERVER_DUMP_R2_ACCESS_KEY_ID: 'the-access-key-id',
  POI_SERVER_DUMP_R2_SECRET_ACCESS_KEY: 'the-super-secret-value',
}
const fakeDatabasePassword = 'db-password-for-test'
const fakeDatabaseUrl = `postgresql://poi:${fakeDatabasePassword}@localhost:5432/poi`

const publishedRun: DumpRunRow = {
  id: 9,
  dumpMonth: '2026-07',
  schemaVersion: 1,
  status: 'published',
  manifestObjectKey: '2026-07/manifest.json',
  manifestBytes: 10,
  manifestSha256: 'a'.repeat(64),
  publishedAt: new Date('2026-08-01T00:00:00.000Z'),
  cleanupEligibleAt: new Date('2026-08-08T00:00:00.000Z'),
  cleanedAt: null,
  error: null,
}

const eligibleRuns: readonly DumpRunRow[] = [
  { ...publishedRun, id: 7, dumpMonth: '2026-05' },
  { ...publishedRun, id: 8, dumpMonth: '2026-06' },
]

const makeFakeDeps = (
  overrides: Partial<DumpMaintenanceCommandDeps> = {},
): {
  deps: DumpMaintenanceCommandDeps
  calls: string[]
  pool: { end: ReturnType<typeof vi.fn> }
  client: PartitionPoolClient
} => {
  const calls: string[] = []
  const client: PartitionPoolClient = {
    query: vi.fn(),
    release: vi.fn(() => calls.push('release')),
  }
  const dumpPool: DumpPool = {
    connect: vi.fn(async () => {
      calls.push('connect')
      return { ...client, streamQuery: vi.fn() }
    }),
  }
  const pool = { end: vi.fn() }

  const deps: DumpMaintenanceCommandDeps = {
    resolveDatabaseUrl: () => {
      calls.push('resolveDatabaseUrl')
      return fakeDatabaseUrl
    },
    resolveDatabaseBackend: () => {
      calls.push('resolveDatabaseBackend')
      return 'postgresql'
    },
    loadR2Config: () => {
      calls.push('loadR2Config')
      return loadR2ObjectStoreConfigFromEnv(fakeR2Env)
    },
    createObjectStore: () => {
      calls.push('createObjectStore')
      return { putIfAbsent: vi.fn(), getObject: vi.fn() }
    },
    createOfflineDumpPool: () => {
      calls.push('createOfflineDumpPool')
      return pool as never
    },
    createDumpPoolFromPgPool: () => {
      calls.push('createDumpPoolFromPgPool')
      return dumpPool
    },
    endPool: async () => {
      calls.push('endPool')
      await pool.end()
    },
    now: () => new Date('2026-08-01T00:30:00.000+09:00'),
    createUpcomingMonthPartitions: async (_pool, month) => {
      calls.push(`createUpcomingMonthPartitions:${month}`)
      return [
        {
          table: 'create_ship_records',
          partitionName: 'create_ship_records_2026_09',
          action: 'created',
        },
      ]
    },
    publishDumpMonth: async (_pool, _store, month) => {
      calls.push(`publishDumpMonth:${month}`)
      return publishedRun
    },
    listCleanupEligibleDumpRuns: async () => {
      calls.push('listCleanupEligibleDumpRuns')
      return eligibleRuns
    },
    cleanupDumpRun: async (_pool, _store, runId) => {
      if (typeof runId !== 'number') {
        throw new Error('expected a numeric run id')
      }
      calls.push(`cleanupDumpRun:${runId}`)
      const result: CleanupDumpRunResult = {
        runId,
        action: 'cleaned',
        partitionsDropped: [`partition_${runId}`],
      }
      return result
    },
    ...overrides,
  }

  return { deps, calls, pool, client }
}

describe('runDumpMaintenanceCommand', () => {
  test('creates next-month partitions, publishes the previous month, and cleans every eligible run', async () => {
    const { deps, calls, pool, client } = makeFakeDeps()

    const result = await runDumpMaintenanceCommand([], {}, deps)

    expect(result.previousDumpMonth).toBe('2026-07')
    expect(result.upcomingDumpMonth).toBe('2026-09')
    expect(result.publishedRun).toBe(publishedRun)
    expect(result.cleanups.map((cleanup) => cleanup.runId)).toEqual([7, 8])
    expect(calls).toEqual([
      'resolveDatabaseUrl',
      'resolveDatabaseBackend',
      'createOfflineDumpPool',
      'createDumpPoolFromPgPool',
      'createUpcomingMonthPartitions:2026-09',
      'loadR2Config',
      'createObjectStore',
      'publishDumpMonth:2026-07',
      'connect',
      'listCleanupEligibleDumpRuns',
      'release',
      'cleanupDumpRun:7',
      'cleanupDumpRun:8',
      'endPool',
    ])
    expect(client.release).toHaveBeenCalledOnce()
    expect(pool.end).toHaveBeenCalledOnce()
  })

  test('rejects arguments before touching configuration or infrastructure', async () => {
    const { deps, calls } = makeFakeDeps()

    await expect(runDumpMaintenanceCommand(['unexpected'], {}, deps)).rejects.toThrow(/Usage/)

    expect(calls).toEqual([])
  })

  test('requires PostgreSQL before loading R2 configuration or opening a pool', async () => {
    const { deps, calls } = makeFakeDeps({
      resolveDatabaseBackend: () => {
        calls.push('resolveDatabaseBackend')
        return 'mongodb'
      },
    })

    await expect(runDumpMaintenanceCommand([], {}, deps)).rejects.toThrow(
      /requires a postgres: or postgresql: database URL/,
    )
    expect(calls).toEqual(['resolveDatabaseUrl', 'resolveDatabaseBackend'])
  })

  test('still creates upcoming partitions when R2 configuration is unavailable', async () => {
    const createPartitions = vi.fn(async () => [])
    const publish = vi.fn(async () => publishedRun)
    const discover = vi.fn(async () => eligibleRuns)
    const { deps, pool } = makeFakeDeps({
      createUpcomingMonthPartitions: createPartitions,
      loadR2Config: () => {
        throw new Error('R2 credentials are missing')
      },
      publishDumpMonth: publish,
      listCleanupEligibleDumpRuns: discover,
    })

    await expect(runDumpMaintenanceCommand([], {}, deps)).rejects.toThrow(
      /initialize R2 object store: R2 credentials are missing/,
    )

    expect(createPartitions).toHaveBeenCalledWith(pool, '2026-09')
    expect(publish).not.toHaveBeenCalled()
    expect(discover).not.toHaveBeenCalled()
    expect(pool.end).toHaveBeenCalledOnce()
  })

  test('releases the listing client and ends the pool when cleanup discovery fails', async () => {
    const { deps, pool, client } = makeFakeDeps({
      listCleanupEligibleDumpRuns: async () => {
        throw new Error('discovery failed')
      },
    })

    await expect(runDumpMaintenanceCommand([], {}, deps)).rejects.toThrow('discovery failed')

    expect(client.release).toHaveBeenCalledOnce()
    expect(pool.end).toHaveBeenCalledOnce()
  })

  test('attempts independent phases and later cleanups after earlier failures', async () => {
    const cleanup = vi.fn(async (_pool, _store, runId: unknown): Promise<CleanupDumpRunResult> => {
      if (runId === 7) {
        throw new Error('first cleanup failed')
      }
      if (typeof runId !== 'number') {
        throw new Error('expected a numeric run id')
      }
      return { runId, action: 'cleaned', partitionsDropped: [] }
    })
    const publish = vi.fn(async () => publishedRun)
    const { deps, pool } = makeFakeDeps({
      createUpcomingMonthPartitions: async () => {
        throw new Error('partition creation failed')
      },
      publishDumpMonth: publish,
      cleanupDumpRun: cleanup,
    })

    await expect(runDumpMaintenanceCommand([], {}, deps)).rejects.toThrow(
      /create upcoming partitions.*partition creation failed[\s\S]*clean dump run 7.*first cleanup failed/,
    )

    expect(publish).toHaveBeenCalledOnce()
    expect(cleanup.mock.calls.map((call) => call[2])).toEqual([7, 8])
    expect(pool.end).toHaveBeenCalledOnce()
  })

  test('redacts database and R2 secrets from maintenance failures', async () => {
    const { deps } = makeFakeDeps({
      publishDumpMonth: async () => {
        throw new Error(
          `failed with ${fakeDatabasePassword}, the-access-key-id, and the-super-secret-value`,
        )
      },
    })

    let thrown: Error | undefined
    try {
      await runDumpMaintenanceCommand([], {}, deps)
    } catch (error) {
      thrown = error as Error
    }

    expect(thrown?.message).toContain('<redacted>')
    expect(thrown?.message).not.toContain(fakeDatabasePassword)
    expect(thrown?.message).not.toContain('the-access-key-id')
    expect(thrown?.message).not.toContain('the-super-secret-value')
  })
})

describe('defaultDumpMaintenanceCommandDeps', () => {
  test('wires the production maintenance functions', () => {
    expect(defaultDumpMaintenanceCommandDeps.now()).toBeInstanceOf(Date)
    expect(defaultDumpMaintenanceCommandDeps.listCleanupEligibleDumpRuns).toBeTypeOf('function')
    expect(defaultDumpMaintenanceCommandDeps.cleanupDumpRun).toBeTypeOf('function')
  })
})

test('dumpMaintenanceCommandUsage documents the no-argument command', () => {
  expect(dumpMaintenanceCommandUsage).toBe('db:dumps:maintain')
})
