import { PartitionMaintenanceError } from './errors'

/**
 * Shared YYYY-MM parser and exact Asia/Tokyo (JST) month boundaries for the Community Dump
 * monthly partition maintenance/repair seam (docs/postgresql-migration-plan.md lines 713-739,
 * 721-722: "Assign observations to Dump Months using Japan Standard Time calendar boundaries,
 * expressed as exact UTC instants in partition definitions").
 *
 * Asia/Tokyo has used a fixed UTC+9 offset with no daylight-saving transitions since 1951, so
 * every JST calendar-month boundary maps to exactly one UTC instant with no ambiguity: the JST
 * midnight that starts a month is always nine hours before the same wall-clock date's UTC
 * midnight. `Date.UTC` already normalizes out-of-range month/hour components (for example
 * `Date.UTC(year, 11, 1, -9, ...)` rolls into December of the same year, and
 * `Date.UTC(year, 12, 1, -9, ...)` rolls into January of `year + 1`), so plain integer
 * arithmetic on the parsed year/month is sufficient without a timezone library.
 */

export interface DumpMonthParts {
  readonly text: string
  readonly year: number
  readonly month: number
}

export interface DumpMonthBoundsUtc {
  readonly lowerBoundUtc: Date
  readonly upperBoundUtc: Date
}

export interface AdjacentJstDumpMonths {
  readonly previous: string
  readonly next: string
}

const dumpMonthPattern = /^([0-9]{4})-(0[1-9]|1[0-2])$/
const jstOffsetMilliseconds = 9 * 60 * 60 * 1000

export const parseDumpMonth = (value: string): DumpMonthParts => {
  const match = dumpMonthPattern.exec(value)
  if (!match) {
    throw new PartitionMaintenanceError(`Dump Month must be formatted as YYYY-MM, got "${value}"`)
  }
  return {
    text: value,
    year: Number(match[1]),
    month: Number(match[2]),
  }
}

export const computeDumpMonthBoundsUtc = (parts: DumpMonthParts): DumpMonthBoundsUtc => {
  const monthIndex0 = parts.month - 1
  const boundary = (monthIndex: number) => {
    const date = new Date(0)
    date.setUTCHours(0, 0, 0, 0)
    date.setUTCFullYear(parts.year, monthIndex, 1)
    date.setUTCHours(-9, 0, 0, 0)
    return date
  }
  return {
    lowerBoundUtc: boundary(monthIndex0),
    upperBoundUtc: boundary(monthIndex0 + 1),
  }
}

const formatNormalizedDumpMonth = (year: number, monthIndex0: number): string => {
  const normalized = new Date(0)
  normalized.setUTCHours(0, 0, 0, 0)
  normalized.setUTCFullYear(year, monthIndex0, 1)
  return `${normalized.getUTCFullYear()}-${String(normalized.getUTCMonth() + 1).padStart(2, '0')}`
}

export const deriveAdjacentJstDumpMonths = (now: Date): AdjacentJstDumpMonths => {
  if (Number.isNaN(now.getTime())) {
    throw new PartitionMaintenanceError('Cannot derive Dump Months from an invalid date')
  }
  const jstNow = new Date(now.getTime() + jstOffsetMilliseconds)
  const year = jstNow.getUTCFullYear()
  const monthIndex0 = jstNow.getUTCMonth()
  return {
    previous: formatNormalizedDumpMonth(year, monthIndex0 - 1),
    next: formatNormalizedDumpMonth(year, monthIndex0 + 1),
  }
}

const paddedMonth = (parts: DumpMonthParts): string => String(parts.month).padStart(2, '0')

/**
 * Deterministic, safe monthly partition name for `table` and `parts`. Safety comes from the
 * inputs, not from escaping: `table` must already be one of the nine allowlisted Observation
 * parent tables (see observation-tables.ts) and `parts` must already come from `parseDumpMonth`,
 * so the result only ever contains the characters `[a-z0-9_]`.
 */
export const deriveMonthlyPartitionName = (table: string, parts: DumpMonthParts): string =>
  `${table}_${parts.year}_${paddedMonth(parts)}`

/**
 * Deterministic staging-table name used only for the lifetime of one repair transaction, kept
 * distinct from `deriveMonthlyPartitionName` so a table with the final partition name can never
 * be mistaken for in-progress staging state (and vice versa).
 */
export const derivePendingPartitionName = (table: string, parts: DumpMonthParts): string =>
  `${table}_pending_${parts.year}_${paddedMonth(parts)}`

export const deriveDefaultPartitionName = (table: string): string => `${table}_default`
