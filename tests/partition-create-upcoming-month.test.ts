import { describe, expect, test, vi } from 'vitest'

import {
  type PartitionPool,
  type PartitionQueryResult,
} from '../src/db/postgres/partitions/adapter'
import {
  createUpcomingMonthPartitions,
  type CreateUpcomingMonthPartitionOutcome,
} from '../src/db/postgres/partitions/create-upcoming-month'
import {
  computeDumpMonthBoundsUtc,
  deriveDefaultPartitionName,
  deriveMonthlyPartitionName,
  parseDumpMonth,
} from '../src/db/postgres/partitions/dump-month'
import { observationParentTables } from '../src/db/postgres/partitions/observation-tables'
import { PartitionMaintenanceError } from '../src/db/postgres/partitions/errors'

interface FakeRelation {
  readonly parentTable: string
  readonly lowerBoundUtc: Date
  readonly upperBoundUtc: Date
  readonly isDefault?: boolean
}

interface FakeDatabase {
  relations: Map<string, FakeRelation>
  defaultConflictRows: Map<string, number>
}

const emptyResult: PartitionQueryResult = { rows: [], rowCount: 0 }

const catalogRowFor = (relation: FakeRelation): Record<string, unknown> => ({
  parent_table: relation.parentTable,
  is_default_partition: relation.isDefault ?? false,
  bound_expression: relation.isDefault
    ? 'FOR VALUES DEFAULT'
    : `FOR VALUES FROM ('${relation.lowerBoundUtc.toISOString()}') TO ('${relation.upperBoundUtc.toISOString()}')`,
  lower_bound: relation.isDefault ? null : relation.lowerBoundUtc,
  upper_bound: relation.isDefault ? null : relation.upperBoundUtc,
})

const createMatch =
  /^create table "([a-z_][a-z0-9_]*)" partition of "([a-z_][a-z0-9_]*)" for values from \('([^']+)'::timestamptz\) to \('([^']+)'::timestamptz\)$/i

const conflictCheckMatch =
  /^select 1 from only "([a-z_][a-z0-9_]*)" where ingested_at >= \$1 and ingested_at < \$2 limit 1$/i

// Records every issued query, backed by a shared in-memory "database" (`FakeDatabase`) so state
// created on one `pool.connect()` (one table's transaction) is visible to later connections,
// matching how a real PostgreSQL database persists DDL across separate connections/transactions.
const createFakePoolAndDatabase = (): {
  pool: PartitionPool
  database: FakeDatabase
  calls: string[]
} => {
  const database: FakeDatabase = { relations: new Map(), defaultConflictRows: new Map() }
  const calls: string[] = []

  const query = vi.fn(
    async (text: string, values?: readonly unknown[]): Promise<PartitionQueryResult> => {
      calls.push(text)
      const normalized = text.trim()

      if (normalized === 'begin' || normalized === 'commit' || normalized === 'rollback') {
        return emptyResult
      }
      if (normalized.includes('pg_advisory_xact_lock')) {
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

      const create = createMatch.exec(normalized)
      if (create) {
        const [, relationName, parentTable, lowerIso, upperIso] = create
        database.relations.set(relationName, {
          parentTable,
          lowerBoundUtc: new Date(lowerIso),
          upperBoundUtc: new Date(upperIso),
        })
        return emptyResult
      }

      const conflictCheck = conflictCheckMatch.exec(normalized)
      if (conflictCheck) {
        const defaultName = conflictCheck[1]
        const conflictCount = database.defaultConflictRows.get(defaultName) ?? 0
        return conflictCount > 0 ? { rows: [{}], rowCount: 1 } : emptyResult
      }

      throw new Error(`Unexpected query in test fake: ${normalized}`)
    },
  )

  const pool: PartitionPool = {
    connect: vi.fn(async () => ({ query, release: vi.fn() })),
  }

  return { pool, database, calls }
}

const dumpMonth = '2026-07'
const parts = parseDumpMonth(dumpMonth)
const bounds = computeDumpMonthBoundsUtc(parts)

// Idempotent offline create-upcoming-month command for all nine Observation parents
// (docs/postgresql-migration-plan.md lines 713-739, 725-727: "Create upcoming Dump Month
// partitions before their boundary ... rows in it indicate partition maintenance failure").
describe('createUpcomingMonthPartitions', () => {
  test('creates an exact monthly partition for every one of the nine tables when none exist', async () => {
    const { pool } = createFakePoolAndDatabase()

    const outcomes = await createUpcomingMonthPartitions(pool, dumpMonth)

    expect(outcomes).toHaveLength(9)
    expect(outcomes.map((outcome) => outcome.table).sort()).toEqual(
      [...observationParentTables].sort(),
    )
    for (const outcome of outcomes) {
      expect(outcome.action).toBe('created')
      expect(outcome.partitionName).toBe(deriveMonthlyPartitionName(outcome.table, parts))
    }
  })

  test('is idempotent: an existing exact partition succeeds as a no-op without issuing CREATE TABLE', async () => {
    const { pool, database, calls } = createFakePoolAndDatabase()
    const table = 'create_ship_records'
    const partitionName = deriveMonthlyPartitionName(table, parts)
    database.relations.set(partitionName, { parentTable: table, ...bounds })

    const outcomes = await createUpcomingMonthPartitions(pool, dumpMonth)

    const outcomeForTable = outcomes.find(
      (outcome) => outcome.table === table,
    ) as CreateUpcomingMonthPartitionOutcome
    expect(outcomeForTable.action).toBe('already-exact')
    expect(calls.some((call) => call.trim().startsWith(`create table "${partitionName}"`))).toBe(
      false,
    )
  })

  test('rejects a mismatched existing partition (wrong bounds) for that table', async () => {
    const { pool, database } = createFakePoolAndDatabase()
    const mismatchedTable = 'create_ship_records'
    const partitionName = deriveMonthlyPartitionName(mismatchedTable, parts)
    database.relations.set(partitionName, {
      parentTable: mismatchedTable,
      lowerBoundUtc: new Date('2099-01-01T00:00:00.000Z'),
      upperBoundUtc: new Date('2099-02-01T00:00:00.000Z'),
    })

    await expect(createUpcomingMonthPartitions(pool, dumpMonth)).rejects.toThrow(
      PartitionMaintenanceError,
    )
    await expect(createUpcomingMonthPartitions(pool, dumpMonth)).rejects.toThrow(
      new RegExp(mismatchedTable),
    )
  })

  test('other, unaffected tables still succeed even when one table has a mismatched existing partition', async () => {
    const { pool, database, calls } = createFakePoolAndDatabase()
    const mismatchedTable = 'create_ship_records'
    const partitionName = deriveMonthlyPartitionName(mismatchedTable, parts)
    database.relations.set(partitionName, {
      parentTable: mismatchedTable,
      lowerBoundUtc: new Date('2099-01-01T00:00:00.000Z'),
      upperBoundUtc: new Date('2099-02-01T00:00:00.000Z'),
    })

    await expect(createUpcomingMonthPartitions(pool, dumpMonth)).rejects.toThrow(
      PartitionMaintenanceError,
    )

    for (const table of observationParentTables) {
      if (table === mismatchedTable) continue
      const otherPartitionName = deriveMonthlyPartitionName(table, parts)
      expect(
        calls.some((call) => call.trim().startsWith(`create table "${otherPartitionName}"`)),
      ).toBe(true)
    }
  })

  test('reports every failing table in one aggregated error message', async () => {
    const { pool, database } = createFakePoolAndDatabase()
    for (const table of ['create_ship_records', 'drop_ship_records'] as const) {
      const partitionName = deriveMonthlyPartitionName(table, parts)
      database.relations.set(partitionName, {
        parentTable: table,
        lowerBoundUtc: new Date('2099-01-01T00:00:00.000Z'),
        upperBoundUtc: new Date('2099-02-01T00:00:00.000Z'),
      })
    }

    await expect(createUpcomingMonthPartitions(pool, dumpMonth)).rejects.toThrow(
      /create_ship_records/,
    )
    await expect(createUpcomingMonthPartitions(pool, dumpMonth)).rejects.toThrow(
      /drop_ship_records/,
    )
  })

  test('refuses to create a partition when the default already has matching rows, and points to the repair command', async () => {
    const { pool, database } = createFakePoolAndDatabase()
    const defaultName = deriveDefaultPartitionName('create_ship_records')
    database.defaultConflictRows.set(defaultName, 3)

    await expect(createUpcomingMonthPartitions(pool, dumpMonth)).rejects.toThrow(/repair/i)
  })

  test('never issues CREATE TABLE for a table whose default already has matching rows, while other tables still succeed', async () => {
    const { pool, database, calls } = createFakePoolAndDatabase()
    const conflictedTable = 'create_ship_records'
    const defaultName = deriveDefaultPartitionName(conflictedTable)
    database.defaultConflictRows.set(defaultName, 1)

    await expect(createUpcomingMonthPartitions(pool, dumpMonth)).rejects.toThrow(
      PartitionMaintenanceError,
    )

    const conflictedPartitionName = deriveMonthlyPartitionName(conflictedTable, parts)
    expect(
      calls.some((call) => call.trim().startsWith(`create table "${conflictedPartitionName}"`)),
    ).toBe(false)
    for (const table of observationParentTables) {
      if (table === conflictedTable) continue
      const partitionName = deriveMonthlyPartitionName(table, parts)
      expect(calls.some((call) => call.trim().startsWith(`create table "${partitionName}"`))).toBe(
        true,
      )
    }
  })

  test('rejects a malformed Dump Month before connecting to the database', async () => {
    const { pool } = createFakePoolAndDatabase()
    const connectSpy = vi.mocked(pool.connect)

    await expect(createUpcomingMonthPartitions(pool, 'not-a-month')).rejects.toThrow(
      PartitionMaintenanceError,
    )
    expect(connectSpy).not.toHaveBeenCalled()
  })
})
