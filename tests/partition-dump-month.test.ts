import { describe, expect, test } from 'vitest'

import { observationParentTables } from '../src/db/postgres/partitions/observation-tables'
import {
  computeDumpMonthBoundsUtc,
  deriveAdjacentJstDumpMonths,
  deriveDefaultPartitionName,
  deriveMonthlyPartitionName,
  derivePendingPartitionName,
  parseDumpMonth,
} from '../src/db/postgres/partitions/dump-month'
import { PartitionMaintenanceError } from '../src/db/postgres/partitions/errors'

// Shared YYYY-MM parser and exact Asia/Tokyo month boundaries expressed as UTC instants
// (docs/postgresql-migration-plan.md lines 713-739, 721-722: "Assign observations to Dump
// Months using Japan Standard Time calendar boundaries, expressed as exact UTC instants").
// Asia/Tokyo has used a fixed UTC+9 offset with no DST since 1951, so every JST month boundary
// converts to one exact UTC instant with no ambiguity.
describe('parseDumpMonth', () => {
  test.each(['2026-01', '2026-07', '2026-12', '0001-01', '9999-12'])(
    'accepts the well-formed Dump Month %s',
    (value) => {
      expect(parseDumpMonth(value)).toEqual({
        text: value,
        year: Number(value.slice(0, 4)),
        month: Number(value.slice(5, 7)),
      })
    },
  )

  test.each([
    ['2026-13', 'month 13'],
    ['2026-00', 'month 00'],
    ['2026-1', 'unpadded month'],
    ['26-01', 'two-digit year'],
    ['2026/01', 'slash separator'],
    ['2026-07-01', 'day included'],
    ['2026-07T00:00', 'timestamp text'],
    ['', 'empty string'],
    ['2026-07 ', 'trailing whitespace'],
    [' 2026-07', 'leading whitespace'],
    ["2026-07'; drop table create_ship_records; --", 'SQL injection attempt'],
  ])('rejects the malformed Dump Month %s (%s)', (value) => {
    expect(() => parseDumpMonth(value)).toThrow(PartitionMaintenanceError)
    expect(() => parseDumpMonth(value)).toThrow(/YYYY-MM/)
  })
})

describe('deriveAdjacentJstDumpMonths', () => {
  test.each([
    ['2026-07-31T14:59:59.999Z', '2026-06', '2026-08'],
    ['2026-07-31T15:00:00.000Z', '2026-07', '2026-09'],
    ['2026-12-31T15:00:00.000Z', '2026-12', '2027-02'],
    ['2026-01-01T00:00:00.000Z', '2025-12', '2026-02'],
  ])('derives the previous closed and next upcoming JST months at %s', (now, previous, next) => {
    expect(deriveAdjacentJstDumpMonths(new Date(now))).toEqual({ previous, next })
  })

  test('rejects an invalid date', () => {
    expect(() => deriveAdjacentJstDumpMonths(new Date(Number.NaN))).toThrow(
      PartitionMaintenanceError,
    )
  })
})

describe('computeDumpMonthBoundsUtc', () => {
  test.each([
    ['2026-01', '2025-12-31T15:00:00.000Z', '2026-01-31T15:00:00.000Z'],
    ['2026-07', '2026-06-30T15:00:00.000Z', '2026-07-31T15:00:00.000Z'],
    ['2026-12', '2026-11-30T15:00:00.000Z', '2026-12-31T15:00:00.000Z'],
    // December of one JST year rolls the upper bound into January of the next UTC year.
    ['2025-12', '2025-11-30T15:00:00.000Z', '2025-12-31T15:00:00.000Z'],
    // 2028 is a leap year in the Gregorian calendar; the lower bound for March is unaffected,
    // but this exercises Date.UTC's day-count handling across a leap February.
    ['2028-03', '2028-02-29T15:00:00.000Z', '2028-03-31T15:00:00.000Z'],
    ['2027-02', '2027-01-31T15:00:00.000Z', '2027-02-28T15:00:00.000Z'],
    ['0001-01', '0000-12-31T15:00:00.000Z', '0001-01-31T15:00:00.000Z'],
  ])('computes exact UTC bounds for JST month %s', (value, expectedLower, expectedUpper) => {
    const parts = parseDumpMonth(value)
    const bounds = computeDumpMonthBoundsUtc(parts)
    expect(bounds.lowerBoundUtc.toISOString()).toBe(expectedLower)
    expect(bounds.upperBoundUtc.toISOString()).toBe(expectedUpper)
  })

  test('the upper bound of one month is the exact lower bound of the next month', () => {
    const june = computeDumpMonthBoundsUtc(parseDumpMonth('2026-06'))
    const july = computeDumpMonthBoundsUtc(parseDumpMonth('2026-07'))
    expect(june.upperBoundUtc.getTime()).toBe(july.lowerBoundUtc.getTime())
  })

  test('December rolls the upper bound into January of the following UTC/JST year', () => {
    const bounds = computeDumpMonthBoundsUtc(parseDumpMonth('2026-12'))
    expect(bounds.upperBoundUtc.toISOString()).toBe('2026-12-31T15:00:00.000Z')
    const nextJanuary = computeDumpMonthBoundsUtc(parseDumpMonth('2027-01'))
    expect(bounds.upperBoundUtc.getTime()).toBe(nextJanuary.lowerBoundUtc.getTime())
  })
})

describe('deterministic safe partition name derivation', () => {
  const safeIdentifierPattern = /^[a-z_][a-z0-9_]*$/

  test.each(observationParentTables)('derives safe deterministic names for %s', (table) => {
    const parts = parseDumpMonth('2026-07')
    const partitionName = deriveMonthlyPartitionName(table, parts)
    const pendingName = derivePendingPartitionName(table, parts)
    const defaultName = deriveDefaultPartitionName(table)

    expect(partitionName).toBe(`${table}_2026_07`)
    expect(pendingName).toBe(`${table}_pending_2026_07`)
    expect(defaultName).toBe(`${table}_default`)

    for (const name of [partitionName, pendingName, defaultName]) {
      expect(name).toMatch(safeIdentifierPattern)
    }
  })

  test('names are deterministic across repeated calls for the same input', () => {
    const table = 'create_ship_records'
    const parts = parseDumpMonth('2026-07')
    expect(deriveMonthlyPartitionName(table, parts)).toBe(deriveMonthlyPartitionName(table, parts))
    expect(derivePendingPartitionName(table, parts)).toBe(derivePendingPartitionName(table, parts))
  })

  test('single-digit months are always zero-padded', () => {
    const parts = parseDumpMonth('2026-01')
    expect(deriveMonthlyPartitionName('create_ship_records', parts)).toBe(
      'create_ship_records_2026_01',
    )
  })

  test('different months for the same table produce different partition names', () => {
    const table = 'create_ship_records'
    const nameJanuary = deriveMonthlyPartitionName(table, parseDumpMonth('2026-01'))
    const nameFebruary = deriveMonthlyPartitionName(table, parseDumpMonth('2026-02'))
    expect(nameJanuary).not.toBe(nameFebruary)
  })

  test('the pending staging name never collides with the final partition name', () => {
    const table = 'create_ship_records'
    const parts = parseDumpMonth('2026-07')
    expect(derivePendingPartitionName(table, parts)).not.toBe(
      deriveMonthlyPartitionName(table, parts),
    )
  })
})
