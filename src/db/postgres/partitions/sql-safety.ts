import { PartitionMaintenanceError } from './errors'

/**
 * Final safety checks before an identifier or timestamp literal is interpolated into partition
 * DDL text. PostgreSQL's `CREATE TABLE ... PARTITION OF ... FOR VALUES FROM (...) TO (...)`,
 * `ALTER TABLE ... ATTACH PARTITION ...`, and `CHECK` constraint clauses all require literal
 * constant expressions; they reject bound query parameters (`$1`) outright. That makes literal
 * interpolation unavoidable for those statements, so every value that reaches this seam's SQL
 * text must pass through one of these two functions first.
 */

const safeIdentifierPattern = /^[a-z_][a-z0-9_]*$/

/** Double-quotes `identifier`, refusing anything that is not a plain lowercase snake_case name. */
export const quoteIdentifier = (identifier: string): string => {
  if (!safeIdentifierPattern.test(identifier)) {
    throw new PartitionMaintenanceError(
      `Refusing to interpolate unsafe SQL identifier: "${identifier}"`,
    )
  }
  return `"${identifier}"`
}

const isoMillisecondPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

/**
 * Renders `date` as an explicit `timestamptz` literal for a DDL partition-bound clause. The
 * `Z`-suffixed ISO-8601 text is unambiguous regardless of the connection's session `TimeZone`
 * setting, so PostgreSQL always parses it back to the exact same UTC instant.
 */
export const toTimestampLiteral = (date: Date): string => {
  if (Number.isNaN(date.getTime())) {
    throw new PartitionMaintenanceError(
      'Refusing to interpolate an invalid Date as a SQL timestamp literal',
    )
  }
  const iso = date.toISOString()
  if (!isoMillisecondPattern.test(iso)) {
    throw new PartitionMaintenanceError(`Unexpected timestamp format for SQL literal: "${iso}"`)
  }
  return `'${iso}'::timestamptz`
}
