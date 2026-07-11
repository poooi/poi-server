import { createHash } from 'crypto'
import { readdir } from 'fs/promises'
import { tmpdir } from 'os'

import { describe, expect, test, vi } from 'vitest'

import { type DumpPool, type DumpQueryRowStream } from '../src/db/postgres/dumps/adapter'
import {
  exportDumpMonthPartitions,
  type ExportedDumpPartition,
} from '../src/db/postgres/dumps/export-partitions'
import {
  CommunityDumpPreconditionError,
  CommunityDumpWorkflowError,
} from '../src/db/postgres/dumps/errors'
import {
  computeDumpMonthBoundsUtc,
  deriveDefaultPartitionName,
  deriveMonthlyPartitionName,
  parseDumpMonth,
} from '../src/db/postgres/partitions/dump-month'
import { PartitionCatalogMismatchError } from '../src/db/postgres/partitions/errors'
import { communityDumpDatasets } from '../src/dumps/community-dump-registry'
import { decompressCommunityDumpBuffer } from '../src/dumps/community-dump-compression'
import { serializeCommunityDumpRecord } from '../src/dumps/community-dump-serializer'

interface FakeRelation {
  readonly parentTable: string
  readonly lowerBoundUtc: Date
  readonly upperBoundUtc: Date
}

interface FakeDatabase {
  readonly relations: Map<string, FakeRelation>
  readonly defaultConflictRows: Map<string, number>
  readonly partitionRows: Map<string, ReadonlyArray<Record<string, unknown>>>
  readonly partitionCountOverrides: Map<string, number>
}

interface FakeQueryResult {
  readonly rows: ReadonlyArray<Record<string, unknown>>
  readonly rowCount: number | null
}

const emptyResult: FakeQueryResult = { rows: [], rowCount: 0 }

const catalogRowFor = (relation: FakeRelation): Record<string, unknown> => ({
  parent_table: relation.parentTable,
  is_default_partition: false,
  bound_expression: `FOR VALUES FROM ('${relation.lowerBoundUtc.toISOString()}') TO ('${relation.upperBoundUtc.toISOString()}')`,
  lower_bound: relation.lowerBoundUtc,
  upper_bound: relation.upperBoundUtc,
})

const conflictCheckMatch =
  /^select 1 from only "([a-z_][a-z0-9_]*)" where ingested_at >= \$1 and ingested_at < \$2 limit 1$/i
const exactCountMatch = /^select count\(\*\) from only "([a-z_][a-z0-9_]*)"$/i
const streamMatch = /^select \* from only "([a-z_][a-z0-9_]*)" order by ingested_at, id$/i

const makeRowStream = (rows: ReadonlyArray<Record<string, unknown>>): DumpQueryRowStream => {
  let index = 0
  return {
    [Symbol.asyncIterator]() {
      return {
        next: async () => {
          if (index >= rows.length) {
            return { done: true as const, value: undefined }
          }
          return { done: false as const, value: rows[index++] }
        },
      }
    },
    destroy: () => {},
  }
}

const dumpMonth = '2098-05'
const parts = parseDumpMonth(dumpMonth)
const bounds = computeDumpMonthBoundsUtc(parts)

const createFakePoolAndDatabase = (): {
  pool: DumpPool
  database: FakeDatabase
  queryCalls: string[]
  streamCalls: string[]
} => {
  const database: FakeDatabase = {
    relations: new Map(),
    defaultConflictRows: new Map(),
    partitionRows: new Map(),
    partitionCountOverrides: new Map(),
  }
  // Every one of the nine tables starts with an exact, catalog-provable monthly partition and
  // an empty default partition — the happy-path starting state that individual tests mutate.
  for (const { table } of communityDumpDatasets) {
    const partitionName = deriveMonthlyPartitionName(table, parts)
    database.relations.set(partitionName, { parentTable: table, ...bounds })
  }

  const queryCalls: string[] = []
  const streamCalls: string[] = []

  const query = vi.fn(
    async (text: string, values?: readonly unknown[]): Promise<FakeQueryResult> => {
      queryCalls.push(text)
      const normalized = text.trim()

      if (
        normalized === 'begin isolation level repeatable read' ||
        normalized === 'commit' ||
        normalized === 'rollback'
      ) {
        return emptyResult
      }
      if (normalized.includes('pg_catalog.pg_class')) {
        const relationName = values?.[0]
        if (typeof relationName !== 'string') {
          throw new Error('expected a relation name parameter')
        }
        const relation = database.relations.get(relationName)
        return relation ? { rows: [catalogRowFor(relation)], rowCount: 1 } : emptyResult
      }

      const conflictCheck = conflictCheckMatch.exec(normalized)
      if (conflictCheck) {
        const defaultName = conflictCheck[1]
        const conflictCount = database.defaultConflictRows.get(defaultName) ?? 0
        return conflictCount > 0 ? { rows: [{}], rowCount: 1 } : emptyResult
      }

      const exactCount = exactCountMatch.exec(normalized)
      if (exactCount) {
        const partitionName = exactCount[1]
        const override = database.partitionCountOverrides.get(partitionName)
        const count = override ?? database.partitionRows.get(partitionName)?.length ?? 0
        return { rows: [{ count: String(count) }], rowCount: 1 }
      }

      throw new Error(`Unexpected query in test fake: ${normalized}`)
    },
  )

  const streamQuery = vi.fn((text: string): DumpQueryRowStream => {
    streamCalls.push(text)
    const normalized = text.trim()
    const match = streamMatch.exec(normalized)
    if (!match) {
      throw new Error(`Unexpected streamQuery call in test fake: ${normalized}`)
    }
    const partitionName = match[1]
    return makeRowStream(database.partitionRows.get(partitionName) ?? [])
  })

  const pool: DumpPool = {
    connect: vi.fn(async () => ({ query, streamQuery, release: vi.fn() })),
  }

  return { pool, database, queryCalls, streamCalls }
}

const createShipTable = communityDumpDatasets.find(
  (definition) => definition.dataset === 'createShipObservations',
)
const battleApiTable = communityDumpDatasets.find(
  (definition) => definition.dataset === 'battleApiObservations',
)
if (!createShipTable || !battleApiTable) {
  throw new Error('test setup: expected createShipObservations and battleApiObservations datasets')
}

const sampleCreateShipRows: ReadonlyArray<Record<string, unknown>> = [
  {
    id: '101',
    ingested_at: new Date('2098-05-10T00:00:00.000Z'),
    items: [1, 2, 3],
    kdock_id: 1,
    secretary: 42,
    ship_id: 500,
    highspeed: true,
    teitoku_lv: 120,
    large_flag: false,
    origin: 'test',
  },
  {
    id: '102',
    ingested_at: new Date('2098-05-11T00:00:00.000Z'),
    items: [],
    kdock_id: 2,
    secretary: 43,
    ship_id: 501,
    highspeed: false,
    teitoku_lv: 121,
    large_flag: true,
    origin: 'test',
  },
]

const sampleBattleApiRows: ReadonlyArray<Record<string, unknown>> = [
  {
    id: '201',
    ingested_at: new Date('2098-05-12T00:00:00.000Z'),
    origin: 'test',
    path: '/kcsapi/api_req_battle_midnight/sp_midnight',
    data: { foo: 'bar' },
  },
]

const seedHappyPathRows = (database: FakeDatabase): void => {
  database.partitionRows.set(
    deriveMonthlyPartitionName(createShipTable!.table, parts),
    sampleCreateShipRows,
  )
  database.partitionRows.set(
    deriveMonthlyPartitionName(battleApiTable!.table, parts),
    sampleBattleApiRows,
  )
}

const findResult = (
  results: readonly ExportedDumpPartition[],
  dataset: string,
): ExportedDumpPartition => {
  const found = results.find((result) => result.dataset === dataset)
  if (!found) {
    throw new Error(`test assertion: expected a result for dataset "${dataset}"`)
  }
  return found
}

// Community Dump publish workflow's streaming export phase
// (docs/postgresql-migration-plan.md lines 740-747, 757-758).
describe('exportDumpMonthPartitions', () => {
  test('exports all nine partitions with correct row counts, decompressed content, and hashes', async () => {
    const { pool, database } = createFakePoolAndDatabase()
    seedHappyPathRows(database)

    const results = await exportDumpMonthPartitions(pool, dumpMonth)

    expect(results).toHaveLength(9)
    expect(results.map((result) => result.dataset).sort()).toEqual(
      communityDumpDatasets.map((definition) => definition.dataset).sort(),
    )

    const createShipResult = findResult(results, 'createShipObservations')
    expect(createShipResult.rowCount).toBe(sampleCreateShipRows.length)
    expect(createShipResult.table).toBe(createShipTable!.table)
    expect(createShipResult.partitionName).toBe(
      deriveMonthlyPartitionName(createShipTable!.table, parts),
    )
    const expectedCreateShipContent = sampleCreateShipRows
      .map((row) => serializeCommunityDumpRecord('createShipObservations', row) + '\n')
      .join('')
    expect(decompressCommunityDumpBuffer(createShipResult.compressed).toString('utf8')).toBe(
      expectedCreateShipContent,
    )
    expect(createShipResult.sha256Hex).toBe(
      createHash('sha256').update(createShipResult.compressed).digest('hex'),
    )
    expect(createShipResult.compressedBytes).toBe(createShipResult.compressed.length)

    const battleApiResult = findResult(results, 'battleApiObservations')
    expect(battleApiResult.rowCount).toBe(sampleBattleApiRows.length)
    const expectedBattleApiContent = sampleBattleApiRows
      .map((row) => serializeCommunityDumpRecord('battleApiObservations', row) + '\n')
      .join('')
    expect(decompressCommunityDumpBuffer(battleApiResult.compressed).toString('utf8')).toBe(
      expectedBattleApiContent,
    )

    for (const result of results) {
      if (
        result.dataset === 'createShipObservations' ||
        result.dataset === 'battleApiObservations'
      ) {
        continue
      }
      expect(result.rowCount).toBe(0)
      expect(decompressCommunityDumpBuffer(result.compressed).length).toBe(0)
    }
  })

  test('refuses when a default partition already has rows for the target month, without streaming anything', async () => {
    const { pool, database, streamCalls } = createFakePoolAndDatabase()
    const defaultName = deriveDefaultPartitionName(createShipTable!.table)
    database.defaultConflictRows.set(defaultName, 1)

    await expect(exportDumpMonthPartitions(pool, dumpMonth)).rejects.toThrow(
      CommunityDumpPreconditionError,
    )
    expect(streamCalls).toHaveLength(0)
  })

  test('aggregates default-partition-conflict failures across multiple tables into one error message', async () => {
    const { pool, database } = createFakePoolAndDatabase()
    database.defaultConflictRows.set(deriveDefaultPartitionName('create_ship_records'), 1)
    database.defaultConflictRows.set(deriveDefaultPartitionName('drop_ship_records'), 2)

    await expect(exportDumpMonthPartitions(pool, dumpMonth)).rejects.toThrow(/create_ship_records/)
    await expect(exportDumpMonthPartitions(pool, dumpMonth)).rejects.toThrow(/drop_ship_records/)
  })

  test('refuses when a monthly partition does not match the expected catalog bounds', async () => {
    const { pool, database, streamCalls } = createFakePoolAndDatabase()
    const partitionName = deriveMonthlyPartitionName(createShipTable!.table, parts)
    database.relations.set(partitionName, {
      parentTable: createShipTable!.table,
      lowerBoundUtc: new Date('2098-06-01T00:00:00.000Z'),
      upperBoundUtc: new Date('2098-07-01T00:00:00.000Z'),
    })

    await expect(exportDumpMonthPartitions(pool, dumpMonth)).rejects.toThrow(
      PartitionCatalogMismatchError,
    )
    expect(streamCalls).toHaveLength(0)
  })

  test('refuses when a monthly partition is missing entirely', async () => {
    const { pool, database } = createFakePoolAndDatabase()
    database.relations.delete(deriveMonthlyPartitionName(createShipTable!.table, parts))

    await expect(exportDumpMonthPartitions(pool, dumpMonth)).rejects.toThrow(
      PartitionCatalogMismatchError,
    )
  })

  test('refuses when the streamed row count does not match an exact count of the closed partition', async () => {
    const { pool, database } = createFakePoolAndDatabase()
    seedHappyPathRows(database)
    database.partitionCountOverrides.set(
      deriveMonthlyPartitionName(createShipTable!.table, parts),
      sampleCreateShipRows.length + 1,
    )

    await expect(exportDumpMonthPartitions(pool, dumpMonth)).rejects.toThrow(
      CommunityDumpWorkflowError,
    )
    await expect(exportDumpMonthPartitions(pool, dumpMonth)).rejects.toThrow(
      new RegExp(deriveMonthlyPartitionName(createShipTable!.table, parts)),
    )
  })

  test('always removes its temporary working directory, including after a failure', async () => {
    const before = await readdir(tmpdir())

    const { pool: happyPool, database: happyDatabase } = createFakePoolAndDatabase()
    seedHappyPathRows(happyDatabase)
    await exportDumpMonthPartitions(happyPool, dumpMonth)

    const { pool: failingPool, database: failingDatabase } = createFakePoolAndDatabase()
    failingDatabase.relations.delete(deriveMonthlyPartitionName(createShipTable!.table, parts))
    await expect(exportDumpMonthPartitions(failingPool, dumpMonth)).rejects.toThrow()

    const after = await readdir(tmpdir())
    const newEntries = after.filter((entry) => !before.includes(entry))
    expect(newEntries.filter((entry) => entry.startsWith('poi-server-dump-export-'))).toHaveLength(
      0,
    )
  })

  test('rejects a malformed Dump Month before connecting to the database', async () => {
    const { pool } = createFakePoolAndDatabase()
    const connectSpy = vi.mocked(pool.connect)

    await expect(exportDumpMonthPartitions(pool, 'not-a-month')).rejects.toThrow()
    expect(connectSpy).not.toHaveBeenCalled()
  })
})
