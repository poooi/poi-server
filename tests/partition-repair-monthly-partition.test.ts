import { describe, expect, test, vi } from 'vitest'

import {
  type PartitionPool,
  type PartitionQueryResult,
} from '../src/db/postgres/partitions/adapter'
import {
  computeDumpMonthBoundsUtc,
  deriveDefaultPartitionName,
  deriveMonthlyPartitionName,
  derivePendingPartitionName,
  parseDumpMonth,
} from '../src/db/postgres/partitions/dump-month'
import {
  PartitionCatalogMismatchError,
  PartitionMaintenanceError,
} from '../src/db/postgres/partitions/errors'
import { repairMonthlyPartition } from '../src/db/postgres/partitions/repair-monthly-partition'

interface FakeRow {
  readonly id: number
  readonly ingested_at: Date
}

interface FakePartitionInfo {
  readonly parentTable: string
  readonly lowerBoundUtc: Date
  readonly upperBoundUtc: Date
}

interface FakeTable {
  rows: FakeRow[]
  partition?: FakePartitionInfo
}

interface FakeDatabase {
  tables: Map<string, FakeTable>
}

type QueryOverride = (
  text: string,
  values: readonly unknown[] | undefined,
  database: FakeDatabase,
) => PartitionQueryResult | undefined

const emptyResult: PartitionQueryResult = { rows: [], rowCount: 0 }
const countResult = (count: number): PartitionQueryResult => ({
  rows: [{ count: String(count) }],
  rowCount: 1,
})

const table = 'create_ship_records'
const dumpMonth = '2026-07'
const parts = parseDumpMonth(dumpMonth)
const { lowerBoundUtc, upperBoundUtc } = computeDumpMonthBoundsUtc(parts)
const partitionName = deriveMonthlyPartitionName(table, parts)
const pendingName = derivePendingPartitionName(table, parts)
const defaultName = deriveDefaultPartitionName(table)

const isWithinMonth = (date: Date): boolean => date >= lowerBoundUtc && date < upperBoundUtc

const catalogRowFor = (info: FakePartitionInfo): Record<string, unknown> => ({
  parent_table: info.parentTable,
  is_default_partition: false,
  bound_expression: `FOR VALUES FROM ('${info.lowerBoundUtc.toISOString()}') TO ('${info.upperBoundUtc.toISOString()}')`,
  lower_bound: info.lowerBoundUtc,
  upper_bound: info.upperBoundUtc,
})

const lockPattern =
  /^lock table "([a-z_][a-z0-9_]*)" in (share update exclusive|share row exclusive) mode$/i
const dropIfExistsPattern = /^drop table if exists "([a-z_][a-z0-9_]*)"$/i
const createLikePattern =
  /^create table "([a-z_][a-z0-9_]*)" \(like "([a-z_][a-z0-9_]*)" including all\)$/i
const dropIdentityPattern =
  /^alter table "([a-z_][a-z0-9_]*)" alter column id drop identity if exists$/i
const addConstraintPattern =
  /^alter table "([a-z_][a-z0-9_]*)" add constraint "([a-z_][a-z0-9_]*)" check/i
const countNoWherePattern = /^select count\(\*\)::text as count from only "([a-z_][a-z0-9_]*)"$/i
const countWithWherePattern =
  /^select count\(\*\)::text as count from only "([a-z_][a-z0-9_]*)" where ingested_at >= \$1 and ingested_at < \$2$/i
const movePattern = /^with moved_rows as \(\s*delete from only "([a-z_][a-z0-9_]*)"/i
const moveInsertIntoPattern = /insert into "([a-z_][a-z0-9_]*)" overriding system value/i
const renamePattern = /^alter table "([a-z_][a-z0-9_]*)" rename to "([a-z_][a-z0-9_]*)"$/i
const attachPattern =
  /^alter table "([a-z_][a-z0-9_]*)" attach partition "([a-z_][a-z0-9_]*)" for values from \('([^']+)'::timestamptz\) to \('([^']+)'::timestamptz\)$/i
const dropConstraintPattern =
  /^alter table "([a-z_][a-z0-9_]*)" drop constraint "([a-z_][a-z0-9_]*)"$/i

const createFakeRepairDatabase = (options: {
  defaultRows?: readonly FakeRow[]
  existingPartition?: { rows: readonly FakeRow[]; info: FakePartitionInfo }
  overrides?: readonly QueryOverride[]
}): { pool: PartitionPool; database: FakeDatabase; calls: string[] } => {
  const database: FakeDatabase = {
    tables: new Map([
      [table, { rows: [] }],
      [defaultName, { rows: [...(options.defaultRows ?? [])] }],
    ]),
  }
  if (options.existingPartition) {
    database.tables.set(partitionName, {
      rows: [...options.existingPartition.rows],
      partition: options.existingPartition.info,
    })
  }
  const calls: string[] = []

  const query = vi.fn(
    async (text: string, values?: readonly unknown[]): Promise<PartitionQueryResult> => {
      calls.push(text)
      const normalized = text.trim()

      for (const override of options.overrides ?? []) {
        const overridden = override(normalized, values, database)
        if (overridden) return overridden
      }

      if (normalized === 'begin' || normalized === 'commit' || normalized === 'rollback') {
        return emptyResult
      }
      if (normalized.includes('pg_advisory_xact_lock')) {
        return emptyResult
      }
      if (lockPattern.test(normalized)) {
        return emptyResult
      }
      if (normalized.includes('pg_catalog.pg_class')) {
        const relationName = values?.[0]
        if (typeof relationName !== 'string') throw new Error('expected a relation name parameter')
        const relation = database.tables.get(relationName)
        return relation?.partition
          ? { rows: [catalogRowFor(relation.partition)], rowCount: 1 }
          : emptyResult
      }

      const dropIfExists = dropIfExistsPattern.exec(normalized)
      if (dropIfExists) {
        database.tables.delete(dropIfExists[1])
        return emptyResult
      }

      const createLike = createLikePattern.exec(normalized)
      if (createLike) {
        database.tables.set(createLike[1], { rows: [] })
        return emptyResult
      }

      if (dropIdentityPattern.test(normalized)) {
        return emptyResult
      }

      if (addConstraintPattern.test(normalized)) {
        return emptyResult
      }

      const countWithWhere = countWithWherePattern.exec(normalized)
      if (countWithWhere) {
        const rows = database.tables.get(countWithWhere[1])?.rows ?? []
        return countResult(rows.filter((row) => isWithinMonth(row.ingested_at)).length)
      }

      const countNoWhere = countNoWherePattern.exec(normalized)
      if (countNoWhere) {
        const rows = database.tables.get(countNoWhere[1])?.rows ?? []
        return countResult(rows.length)
      }

      if (movePattern.test(normalized)) {
        const sourceMatch = movePattern.exec(normalized)
        const destinationMatch = moveInsertIntoPattern.exec(normalized)
        if (!sourceMatch || !destinationMatch) throw new Error('could not parse move statement')
        const sourceTable = database.tables.get(sourceMatch[1])
        const destinationTable = database.tables.get(destinationMatch[1])
        if (!sourceTable || !destinationTable)
          throw new Error('move statement referenced an unknown table')
        const matching = sourceTable.rows.filter((row) => isWithinMonth(row.ingested_at))
        const remaining = sourceTable.rows.filter((row) => !isWithinMonth(row.ingested_at))
        sourceTable.rows = remaining
        destinationTable.rows = [...destinationTable.rows, ...matching]
        return {
          rows: [
            { deleted_count: String(matching.length), inserted_count: String(matching.length) },
          ],
          rowCount: 1,
        }
      }

      const rename = renamePattern.exec(normalized)
      if (rename) {
        const source = database.tables.get(rename[1])
        if (!source) throw new Error('rename referenced an unknown table')
        database.tables.delete(rename[1])
        database.tables.set(rename[2], source)
        return emptyResult
      }

      const attach = attachPattern.exec(normalized)
      if (attach) {
        const [, parentTable, childTable, lowerIso, upperIso] = attach
        const child = database.tables.get(childTable)
        if (!child) throw new Error('attach referenced an unknown table')
        child.partition = {
          parentTable,
          lowerBoundUtc: new Date(lowerIso),
          upperBoundUtc: new Date(upperIso),
        }
        return emptyResult
      }

      if (dropConstraintPattern.test(normalized)) {
        return emptyResult
      }

      throw new Error(`Unexpected query in test fake: ${normalized}`)
    },
  )

  const pool: PartitionPool = {
    connect: vi.fn(async () => ({ query, release: vi.fn() })),
  }

  return { pool, database, calls }
}

const withinMonthRow = (id: number, offsetMs = 0): FakeRow => ({
  id,
  ingested_at: new Date(lowerBoundUtc.getTime() + offsetMs),
})
const outsideMonthRow = (id: number): FakeRow => ({
  id,
  ingested_at: new Date(upperBoundUtc.getTime() + 1000),
})

// Idempotent repair command for exactly one parent + Dump Month
// (docs/postgresql-migration-plan.md lines 713-739, 728-733).
describe('repairMonthlyPartition', () => {
  test('rejects a table outside the nine-table allowlist before connecting', async () => {
    const { pool } = createFakeRepairDatabase({})
    const connectSpy = vi.mocked(pool.connect)

    await expect(
      repairMonthlyPartition(pool, { table: 'schema_metadata', dumpMonth }),
    ).rejects.toThrow(PartitionMaintenanceError)
    expect(connectSpy).not.toHaveBeenCalled()
  })

  test('rejects a malformed Dump Month before connecting', async () => {
    const { pool } = createFakeRepairDatabase({})
    const connectSpy = vi.mocked(pool.connect)

    await expect(repairMonthlyPartition(pool, { table, dumpMonth: 'bogus' })).rejects.toThrow(
      PartitionMaintenanceError,
    )
    expect(connectSpy).not.toHaveBeenCalled()
  })

  test('takes the transaction-scoped advisory lock and both table locks before touching any data', async () => {
    const { pool, calls } = createFakeRepairDatabase({ defaultRows: [withinMonthRow(1)] })

    await repairMonthlyPartition(pool, { table, dumpMonth })

    const normalizedCalls = calls.map((call) => call.trim())
    expect(normalizedCalls[0]).toBe('begin')
    expect(normalizedCalls[1]).toBe('select pg_advisory_xact_lock(hashtextextended($1, 0))')
    expect(normalizedCalls[2]).toBe(`lock table "${table}" in share update exclusive mode`)
    expect(normalizedCalls[3]).toBe(`lock table "${defaultName}" in share row exclusive mode`)
  })

  test('creates a standalone staging table, moves only matching rows preserving identity values, and attaches it as the exact monthly partition', async () => {
    const matching = [withinMonthRow(101), withinMonthRow(102, 60_000)]
    const nonMatching = outsideMonthRow(999)
    const { pool, database, calls } = createFakeRepairDatabase({
      defaultRows: [...matching, nonMatching],
    })

    const result = await repairMonthlyPartition(pool, { table, dumpMonth })

    expect(result).toEqual({
      table,
      dumpMonth,
      partitionName,
      action: 'attached',
      movedRowCount: 2,
    })

    // The default partition keeps only the row outside the target month.
    expect(database.tables.get(defaultName)?.rows).toEqual([nonMatching])
    // The final partition (renamed from the pending staging table) has exactly the two
    // matching rows, with their original identity `id` values preserved.
    const finalPartition = database.tables.get(partitionName)
    expect(finalPartition?.rows.map((row) => row.id).sort()).toEqual([101, 102])
    expect(finalPartition?.partition).toEqual({ parentTable: table, lowerBoundUtc, upperBoundUtc })
    // The pending staging table no longer exists under its own name.
    expect(database.tables.has(pendingName)).toBe(false)

    const normalized = calls.map((call) => call.trim())
    expect(normalized).toContain(`drop table if exists "${pendingName}"`)
    expect(normalized).toContain(`create table "${pendingName}" (like "${table}" including all)`)
    expect(normalized).toContain(
      `alter table "${pendingName}" alter column id drop identity if exists`,
    )
    expect(
      normalized.some((call) => call.startsWith(`alter table "${pendingName}" add constraint`)),
    ).toBe(true)
    expect(normalized).toContain(`alter table "${pendingName}" rename to "${partitionName}"`)
    expect(normalized).toContain(
      `alter table "${table}" attach partition "${partitionName}" for values from ` +
        `('${lowerBoundUtc.toISOString()}'::timestamptz) to ('${upperBoundUtc.toISOString()}'::timestamptz)`,
    )
    expect(calls.some((call) => call.toLowerCase().includes('overriding system value'))).toBe(true)
    expect(normalized[normalized.length - 1]).toBe('commit')
  })

  test('is idempotent: an already-attached exact partition with no leftover default rows is a safe no-op', async () => {
    const existingRows = [withinMonthRow(1), withinMonthRow(2)]
    const { pool, database, calls } = createFakeRepairDatabase({
      defaultRows: [],
      existingPartition: {
        rows: existingRows,
        info: { parentTable: table, lowerBoundUtc, upperBoundUtc },
      },
    })

    const result = await repairMonthlyPartition(pool, { table, dumpMonth })

    expect(result).toEqual({
      table,
      dumpMonth,
      partitionName,
      action: 'already-attached',
      movedRowCount: 0,
    })
    expect(database.tables.get(partitionName)?.rows).toEqual(existingRows)

    const normalized = calls.map((call) => call.trim())
    expect(normalized.some((call) => call.includes('(like'))).toBe(false)
    expect(normalized.some((call) => call.includes('rename to'))).toBe(false)
    expect(normalized.some((call) => call.includes('attach partition'))).toBe(false)
  })

  test('handles an already-attached partition with leftover default rows by moving just those rows in directly', async () => {
    const existingRows = [withinMonthRow(1)]
    const leftover = withinMonthRow(2, 5_000)
    const { pool, database, calls } = createFakeRepairDatabase({
      defaultRows: [leftover],
      existingPartition: {
        rows: existingRows,
        info: { parentTable: table, lowerBoundUtc, upperBoundUtc },
      },
    })

    const result = await repairMonthlyPartition(pool, { table, dumpMonth })

    expect(result.action).toBe('already-attached')
    expect(result.movedRowCount).toBe(1)
    expect(database.tables.get(defaultName)?.rows).toEqual([])
    expect(
      database.tables
        .get(partitionName)
        ?.rows.map((row) => row.id)
        .sort(),
    ).toEqual([1, 2])

    const normalized = calls.map((call) => call.trim())
    expect(normalized.some((call) => call.includes('(like'))).toBe(false)
    expect(normalized.some((call) => call.includes('attach partition'))).toBe(false)
  })

  test('rolls back and rejects when the existing relation with the final name is the DEFAULT partition', async () => {
    const overrides: QueryOverride[] = [
      (text, values) => {
        if (text.includes('pg_catalog.pg_class') && values?.[0] === partitionName) {
          return {
            rows: [
              {
                parent_table: table,
                is_default_partition: true,
                bound_expression: 'FOR VALUES DEFAULT',
                lower_bound: null,
                upper_bound: null,
              },
            ],
            rowCount: 1,
          }
        }
        return undefined
      },
    ]
    const { pool, calls } = createFakeRepairDatabase({ defaultRows: [], overrides })

    await expect(repairMonthlyPartition(pool, { table, dumpMonth })).rejects.toThrow(
      PartitionCatalogMismatchError,
    )
    // No row-moving statement may ever run once the catalog proves a mismatch.
    expect(calls.some((call) => movePattern.test(call.trim()))).toBe(false)
  })

  test('rolls back and rejects when the existing relation with the final name has the wrong parent', async () => {
    const { pool } = createFakeRepairDatabase({
      defaultRows: [],
      existingPartition: {
        rows: [],
        info: { parentTable: 'drop_ship_records', lowerBoundUtc, upperBoundUtc },
      },
    })

    await expect(repairMonthlyPartition(pool, { table, dumpMonth })).rejects.toThrow(
      PartitionCatalogMismatchError,
    )
  })

  test('rolls back and rejects when the existing relation with the final name has the wrong bounds', async () => {
    const { pool } = createFakeRepairDatabase({
      defaultRows: [],
      existingPartition: {
        rows: [],
        info: {
          parentTable: table,
          lowerBoundUtc: new Date('2099-01-01T00:00:00.000Z'),
          upperBoundUtc: new Date('2099-02-01T00:00:00.000Z'),
        },
      },
    })

    await expect(repairMonthlyPartition(pool, { table, dumpMonth })).rejects.toThrow(
      PartitionCatalogMismatchError,
    )
  })

  test('rolls back and rejects when the deleted/inserted row counts do not match the pre-move source count', async () => {
    const overrides: QueryOverride[] = [
      (text) => {
        if (movePattern.test(text)) {
          return { rows: [{ deleted_count: '1', inserted_count: '2' }], rowCount: 1 }
        }
        return undefined
      },
    ]
    const { pool, calls } = createFakeRepairDatabase({
      defaultRows: [withinMonthRow(1)],
      overrides,
    })

    await expect(repairMonthlyPartition(pool, { table, dumpMonth })).rejects.toThrow(
      PartitionMaintenanceError,
    )
    expect(calls.map((call) => call.trim())).toContain('rollback')
  })

  test('rolls back and rejects when the default partition unexpectedly still has matching rows after the move', async () => {
    const overrides: QueryOverride[] = [
      (text, _values, database) => {
        if (
          countWithWherePattern.test(text) &&
          database.tables.get(defaultName)?.rows.length === 0
        ) {
          // Simulate a concurrent write sneaking a row into the default partition after the move.
          return countResult(1)
        }
        return undefined
      },
    ]
    const { pool } = createFakeRepairDatabase({ defaultRows: [withinMonthRow(1)], overrides })

    await expect(repairMonthlyPartition(pool, { table, dumpMonth })).rejects.toThrow(
      PartitionMaintenanceError,
    )
  })

  test('rolls back and rejects when the destination row-count delta does not match the inserted count', async () => {
    let destinationCountCalls = 0
    const overrides: QueryOverride[] = [
      (text) => {
        if (countNoWherePattern.test(text) && countNoWherePattern.exec(text)?.[1] === pendingName) {
          destinationCountCalls += 1
          if (destinationCountCalls === 2) {
            // Second call is the "after" count; report the wrong value.
            return countResult(999)
          }
        }
        return undefined
      },
    ]
    const { pool } = createFakeRepairDatabase({ defaultRows: [withinMonthRow(1)], overrides })

    await expect(repairMonthlyPartition(pool, { table, dumpMonth })).rejects.toThrow(
      PartitionMaintenanceError,
    )
  })

  test('always releases the client, even when the repair fails', async () => {
    const { pool } = createFakeRepairDatabase({
      defaultRows: [],
      existingPartition: {
        rows: [],
        info: { parentTable: 'drop_ship_records', lowerBoundUtc, upperBoundUtc },
      },
    })

    await expect(repairMonthlyPartition(pool, { table, dumpMonth })).rejects.toThrow()

    const client = await vi.mocked(pool.connect).mock.results[0].value
    expect(client.release).toHaveBeenCalled()
  })
})
