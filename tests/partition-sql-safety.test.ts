import { describe, expect, test } from 'vitest'

import { quoteIdentifier, toTimestampLiteral } from '../src/db/postgres/partitions/sql-safety'
import { PartitionMaintenanceError } from '../src/db/postgres/partitions/errors'

// Final choke point before any identifier or timestamp is interpolated into partition-DDL SQL
// text (DDL bound clauses cannot use query parameters; see repair-monthly-partition.ts and
// create-upcoming-month.ts). These helpers defend in depth even though every caller already
// derives its input from the allowlist (observation-tables.ts) and the Dump Month parser
// (dump-month.ts): never interpolate an unvalidated identifier or literal.
describe('quoteIdentifier', () => {
  test.each([
    'create_ship_records',
    'create_ship_records_2026_07',
    'create_ship_records_pending_2026_07',
    'create_ship_records_default',
    '_leading_underscore',
    'a',
  ])('double-quotes the safe identifier %s', (identifier) => {
    expect(quoteIdentifier(identifier)).toBe(`"${identifier}"`)
  })

  test.each([
    ['create_ship_records"; drop table data_epochs; --', 'embedded double quote'],
    ['create ship records', 'embedded space'],
    ['CREATE_SHIP_RECORDS', 'uppercase letters'],
    ['2026_create_ship_records', 'leading digit'],
    ['create-ship-records', 'hyphen'],
    ['', 'empty string'],
    ['create_ship_records;', 'trailing semicolon'],
    ["create_ship_records'", 'trailing single quote'],
    ['create_ship_records\n', 'trailing newline'],
  ])('rejects the unsafe identifier %s (%s)', (identifier) => {
    expect(() => quoteIdentifier(identifier)).toThrow(PartitionMaintenanceError)
    expect(() => quoteIdentifier(identifier)).toThrow(/unsafe/i)
  })
})

describe('toTimestampLiteral', () => {
  test('formats a UTC instant as an explicit, unambiguous timestamptz literal', () => {
    const date = new Date('2026-07-01T00:00:00.000Z')
    expect(toTimestampLiteral(date)).toBe("'2026-07-01T00:00:00.000Z'::timestamptz")
  })

  test('always includes millisecond precision and the Z suffix', () => {
    const date = new Date(Date.UTC(2026, 0, 1, 0, 0, 0, 0))
    expect(toTimestampLiteral(date)).toMatch(
      /^'[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z'::timestamptz$/,
    )
  })

  test('rejects an invalid Date', () => {
    expect(() => toTimestampLiteral(new Date('not-a-date'))).toThrow(PartitionMaintenanceError)
  })
})
