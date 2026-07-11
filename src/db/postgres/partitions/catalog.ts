import { type PartitionQueryClient } from './adapter'
import { PartitionCatalogMismatchError, PartitionMaintenanceError } from './errors'

/**
 * PostgreSQL partition catalog inspection (docs/postgresql-migration-plan.md lines 713-739,
 * 757-758: "Query PostgreSQL catalogs to prove every recorded partition belongs to the expected
 * Observation parent and has the exact JST lower/upper bounds for the Dump Month"). This is the
 * only module that reads `pg_catalog`; every other module in this seam either derives names/
 * bounds in JS or issues DDL/DML built from already-validated inputs.
 *
 * `pg_get_expr(c.relpartbound, c.oid, true)` renders a child partition's bound exactly the way
 * `CREATE TABLE ... PARTITION OF` would declare it:
 *  - a DEFAULT partition renders as the literal text `FOR VALUES DEFAULT`;
 *  - a plain non-partition relation (or one that does not exist) has a `NULL` `relpartbound`, so
 *    `pg_get_expr` returns `NULL`;
 *  - a single-column RANGE partition renders as `FOR VALUES FROM ('<text>') TO ('<text>')`.
 * The embedded `<text>` already carries its own UTC offset (whatever the session's `TimeZone`
 * happens to be), so casting it back to `timestamptz` inside the same query recovers the exact
 * instant regardless of session settings — no `SET TIME ZONE` is required. A composite/"extra
 * expression" bound (for example a second partition-key column) does not match this single-value
 * pattern, so `regexp_match` returns `NULL` and both bound columns come back `NULL` while
 * `is_default_partition` is `false`; callers must treat that combination as an unexpected/
 * unsupported bound, never as a match.
 */

const catalogQuerySql = `
select
  parent.relname as parent_table,
  coalesce(pg_get_expr(c.relpartbound, c.oid, true) in ('DEFAULT', 'FOR VALUES DEFAULT'), false) as is_default_partition,
  pg_get_expr(c.relpartbound, c.oid, true) as bound_expression,
  (regexp_match(
    pg_get_expr(c.relpartbound, c.oid, true),
    '^FOR VALUES FROM \\(''(.+?)''\\) TO \\(''(.+?)''\\)$'
  ))[1]::timestamptz as lower_bound,
  (regexp_match(
    pg_get_expr(c.relpartbound, c.oid, true),
    '^FOR VALUES FROM \\(''(.+?)''\\) TO \\(''(.+?)''\\)$'
  ))[2]::timestamptz as upper_bound
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace and n.nspname = current_schema()
left join pg_catalog.pg_inherits inh on inh.inhrelid = c.oid
left join pg_catalog.pg_class parent on parent.oid = inh.inhparent
where c.relname = $1
`.trim()

export interface PartitionCatalogInfo {
  readonly relationExists: boolean
  readonly parentTable: string | null
  readonly isDefaultPartition: boolean
  readonly boundExpression: string | null
  readonly lowerBoundUtc: Date | null
  readonly upperBoundUtc: Date | null
}

export const inspectPartitionCatalog = async (
  client: PartitionQueryClient,
  relationName: string,
): Promise<PartitionCatalogInfo> => {
  const result = await client.query(catalogQuerySql, [relationName])
  if (result.rows.length === 0) {
    return {
      relationExists: false,
      parentTable: null,
      isDefaultPartition: false,
      boundExpression: null,
      lowerBoundUtc: null,
      upperBoundUtc: null,
    }
  }
  if (result.rows.length > 1) {
    throw new PartitionMaintenanceError(
      `PostgreSQL catalog returned ${result.rows.length} rows for relation "${relationName}"; expected at most 1`,
    )
  }
  const row = result.rows[0]
  return {
    relationExists: true,
    parentTable: typeof row.parent_table === 'string' ? row.parent_table : null,
    isDefaultPartition: row.is_default_partition === true,
    boundExpression: typeof row.bound_expression === 'string' ? row.bound_expression : null,
    lowerBoundUtc: row.lower_bound instanceof Date ? row.lower_bound : null,
    upperBoundUtc: row.upper_bound instanceof Date ? row.upper_bound : null,
  }
}

export interface ExpectedMonthlyPartitionBounds {
  readonly parentTable: string
  readonly lowerBoundUtc: Date
  readonly upperBoundUtc: Date
}

/**
 * Proves `info` (from `inspectPartitionCatalog`) is a real, standalone RANGE partition directly
 * attached to `expected.parentTable` with exactly `expected.lowerBoundUtc`/`upperBoundUtc`.
 * Rejects a missing relation, the DEFAULT partition, the wrong parent (or no parent at all), an
 * unparseable/extra-expression bound, and any bound mismatch.
 */
export const assertExactMonthlyPartitionBounds = (
  relationName: string,
  info: PartitionCatalogInfo,
  expected: ExpectedMonthlyPartitionBounds,
): void => {
  if (!info.relationExists) {
    throw new PartitionCatalogMismatchError(`Relation "${relationName}" does not exist`)
  }
  if (info.parentTable !== expected.parentTable) {
    throw new PartitionCatalogMismatchError(
      `Relation "${relationName}" is attached to parent "${info.parentTable ?? '<none>'}", expected "${expected.parentTable}"`,
    )
  }
  if (info.isDefaultPartition) {
    throw new PartitionCatalogMismatchError(
      `Relation "${relationName}" is the DEFAULT partition of "${info.parentTable ?? 'unknown'}", not an exact monthly partition`,
    )
  }
  if (info.lowerBoundUtc === null || info.upperBoundUtc === null) {
    throw new PartitionCatalogMismatchError(
      `Relation "${relationName}" has an unexpected partition bound expression: ${info.boundExpression ?? '<none>'}`,
    )
  }
  if (
    info.lowerBoundUtc.getTime() !== expected.lowerBoundUtc.getTime() ||
    info.upperBoundUtc.getTime() !== expected.upperBoundUtc.getTime()
  ) {
    throw new PartitionCatalogMismatchError(
      `Relation "${relationName}" has bounds [${info.lowerBoundUtc.toISOString()}, ${info.upperBoundUtc.toISOString()}) ` +
        `but expected [${expected.lowerBoundUtc.toISOString()}, ${expected.upperBoundUtc.toISOString()})`,
    )
  }
}
