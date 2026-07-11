import { describe, expect, test, vi } from 'vitest'

import {
  type PartitionQueryClient,
  type PartitionQueryResult,
} from '../src/db/postgres/partitions/adapter'
import {
  assertExactMonthlyPartitionBounds,
  inspectPartitionCatalog,
  type PartitionCatalogInfo,
} from '../src/db/postgres/partitions/catalog'
import {
  PartitionCatalogMismatchError,
  PartitionMaintenanceError,
} from '../src/db/postgres/partitions/errors'

const lowerBoundUtc = new Date('2026-07-01T00:00:00.000Z')
const upperBoundUtc = new Date('2026-08-01T00:00:00.000Z')

const createFakeClient = (result: PartitionQueryResult): PartitionQueryClient => ({
  query: vi.fn(async () => result),
})

// Postgres catalog inspection that proves a relation is directly attached to the expected
// parent and has the exact JST-month lower/upper UTC bounds (docs/postgresql-migration-plan.md
// lines 713-739, 757-758). `inspectPartitionCatalog` only reads pg_catalog and never accepts a
// value it did not itself just query; `assertExactMonthlyPartitionBounds` is the pure decision
// function so every rejection path (missing, default, wrong parent, wrong bound, extra
// expression) is unit-testable without a database.
describe('inspectPartitionCatalog', () => {
  test('queries pg_catalog by relation name and reports a missing relation', async () => {
    const client = createFakeClient({ rows: [], rowCount: 0 })

    const info = await inspectPartitionCatalog(client, 'create_ship_records_2026_07')

    expect(client.query).toHaveBeenCalledTimes(1)
    const [sql, values] = vi.mocked(client.query).mock.calls[0]
    expect(sql).toContain('pg_catalog.pg_class')
    expect(sql).toContain('pg_catalog.pg_inherits')
    expect(sql).toContain('pg_get_expr')
    expect(values).toEqual(['create_ship_records_2026_07'])
    expect(info).toEqual<PartitionCatalogInfo>({
      relationExists: false,
      parentTable: null,
      isDefaultPartition: false,
      boundExpression: null,
      lowerBoundUtc: null,
      upperBoundUtc: null,
    })
  })

  test('reports a relation that exists but is not attached to any parent', async () => {
    const client = createFakeClient({
      rows: [
        {
          parent_table: null,
          is_default_partition: false,
          bound_expression: null,
          lower_bound: null,
          upper_bound: null,
        },
      ],
      rowCount: 1,
    })

    const info = await inspectPartitionCatalog(client, 'create_ship_records_2026_07')

    expect(info).toEqual<PartitionCatalogInfo>({
      relationExists: true,
      parentTable: null,
      isDefaultPartition: false,
      boundExpression: null,
      lowerBoundUtc: null,
      upperBoundUtc: null,
    })
  })

  test('reports the DEFAULT partition', async () => {
    const client = createFakeClient({
      rows: [
        {
          parent_table: 'create_ship_records',
          is_default_partition: true,
          bound_expression: 'FOR VALUES DEFAULT',
          lower_bound: null,
          upper_bound: null,
        },
      ],
      rowCount: 1,
    })

    const info = await inspectPartitionCatalog(client, 'create_ship_records_default')

    expect(info).toEqual<PartitionCatalogInfo>({
      relationExists: true,
      parentTable: 'create_ship_records',
      isDefaultPartition: true,
      boundExpression: 'FOR VALUES DEFAULT',
      lowerBoundUtc: null,
      upperBoundUtc: null,
    })
  })

  test('reports an exact range partition with parsed UTC bounds', async () => {
    const client = createFakeClient({
      rows: [
        {
          parent_table: 'create_ship_records',
          is_default_partition: false,
          bound_expression:
            "FOR VALUES FROM ('2026-07-01 00:00:00+00') TO ('2026-08-01 00:00:00+00')",
          lower_bound: lowerBoundUtc,
          upper_bound: upperBoundUtc,
        },
      ],
      rowCount: 1,
    })

    const info = await inspectPartitionCatalog(client, 'create_ship_records_2026_07')

    expect(info).toEqual<PartitionCatalogInfo>({
      relationExists: true,
      parentTable: 'create_ship_records',
      isDefaultPartition: false,
      boundExpression: "FOR VALUES FROM ('2026-07-01 00:00:00+00') TO ('2026-08-01 00:00:00+00')",
      lowerBoundUtc: lowerBoundUtc,
      upperBoundUtc: upperBoundUtc,
    })
  })

  test('reports an unparseable bound expression (for example an extra partition-key column) with null bounds', async () => {
    const client = createFakeClient({
      rows: [
        {
          parent_table: 'create_ship_records',
          is_default_partition: false,
          bound_expression:
            "FOR VALUES FROM ('2026-07-01 00:00:00+00', 5) TO ('2026-08-01 00:00:00+00', 10)",
          lower_bound: null,
          upper_bound: null,
        },
      ],
      rowCount: 1,
    })

    const info = await inspectPartitionCatalog(client, 'create_ship_records_2026_07')

    expect(info.isDefaultPartition).toBe(false)
    expect(info.lowerBoundUtc).toBeNull()
    expect(info.upperBoundUtc).toBeNull()
    expect(info.boundExpression).toContain('5')
  })

  test('throws when the catalog unexpectedly returns more than one row for a relation name', async () => {
    const client = createFakeClient({
      rows: [
        {
          parent_table: 'create_ship_records',
          is_default_partition: false,
          bound_expression: null,
          lower_bound: null,
          upper_bound: null,
        },
        {
          parent_table: 'drop_ship_records',
          is_default_partition: false,
          bound_expression: null,
          lower_bound: null,
          upper_bound: null,
        },
      ],
      rowCount: 2,
    })

    await expect(inspectPartitionCatalog(client, 'ambiguous_name')).rejects.toThrow(
      PartitionMaintenanceError,
    )
  })
})

describe('assertExactMonthlyPartitionBounds', () => {
  const expected = { parentTable: 'create_ship_records', lowerBoundUtc, upperBoundUtc }
  const exactInfo: PartitionCatalogInfo = {
    relationExists: true,
    parentTable: 'create_ship_records',
    isDefaultPartition: false,
    boundExpression: "FOR VALUES FROM ('2026-07-01 00:00:00+00') TO ('2026-08-01 00:00:00+00')",
    lowerBoundUtc,
    upperBoundUtc,
  }

  test('does not throw for an exact match', () => {
    expect(() =>
      assertExactMonthlyPartitionBounds('create_ship_records_2026_07', exactInfo, expected),
    ).not.toThrow()
  })

  test('rejects a missing relation', () => {
    const info: PartitionCatalogInfo = {
      relationExists: false,
      parentTable: null,
      isDefaultPartition: false,
      boundExpression: null,
      lowerBoundUtc: null,
      upperBoundUtc: null,
    }
    expect(() =>
      assertExactMonthlyPartitionBounds('create_ship_records_2026_07', info, expected),
    ).toThrow(PartitionCatalogMismatchError)
    expect(() =>
      assertExactMonthlyPartitionBounds('create_ship_records_2026_07', info, expected),
    ).toThrow(/does not exist/)
  })

  test('rejects the DEFAULT partition', () => {
    const info: PartitionCatalogInfo = {
      ...exactInfo,
      isDefaultPartition: true,
      boundExpression: 'FOR VALUES DEFAULT',
      lowerBoundUtc: null,
      upperBoundUtc: null,
    }
    expect(() =>
      assertExactMonthlyPartitionBounds('create_ship_records_default', info, expected),
    ).toThrow(/DEFAULT/)
  })

  test('rejects a relation attached to the wrong parent', () => {
    const info: PartitionCatalogInfo = { ...exactInfo, parentTable: 'drop_ship_records' }
    expect(() =>
      assertExactMonthlyPartitionBounds('create_ship_records_2026_07', info, expected),
    ).toThrow(/drop_ship_records/)
  })

  test('rejects a relation with no parent at all', () => {
    const info: PartitionCatalogInfo = { ...exactInfo, parentTable: null }
    expect(() =>
      assertExactMonthlyPartitionBounds('create_ship_records_2026_07', info, expected),
    ).toThrow(PartitionCatalogMismatchError)
  })

  test('rejects an unparseable/extra-expression bound', () => {
    const info: PartitionCatalogInfo = {
      ...exactInfo,
      boundExpression:
        "FOR VALUES FROM ('2026-07-01 00:00:00+00', 5) TO ('2026-08-01 00:00:00+00', 10)",
      lowerBoundUtc: null,
      upperBoundUtc: null,
    }
    expect(() =>
      assertExactMonthlyPartitionBounds('create_ship_records_2026_07', info, expected),
    ).toThrow(/unexpected/i)
  })

  test('rejects a wrong lower bound', () => {
    const info: PartitionCatalogInfo = {
      ...exactInfo,
      lowerBoundUtc: new Date('2026-07-02T00:00:00.000Z'),
    }
    expect(() =>
      assertExactMonthlyPartitionBounds('create_ship_records_2026_07', info, expected),
    ).toThrow(PartitionCatalogMismatchError)
  })

  test('rejects a wrong upper bound', () => {
    const info: PartitionCatalogInfo = {
      ...exactInfo,
      upperBoundUtc: new Date('2026-08-02T00:00:00.000Z'),
    }
    expect(() =>
      assertExactMonthlyPartitionBounds('create_ship_records_2026_07', info, expected),
    ).toThrow(PartitionCatalogMismatchError)
  })
})
