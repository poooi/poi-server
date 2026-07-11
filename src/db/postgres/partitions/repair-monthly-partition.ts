import { type PartitionPool, type PartitionQueryClient } from './adapter'
import {
  assertExactMonthlyPartitionBounds,
  inspectPartitionCatalog,
  type ExpectedMonthlyPartitionBounds,
} from './catalog'
import {
  computeDumpMonthBoundsUtc,
  deriveDefaultPartitionName,
  deriveMonthlyPartitionName,
  derivePendingPartitionName,
  parseDumpMonth,
} from './dump-month'
import { PartitionMaintenanceError } from './errors'
import { assertObservationParentTable } from './observation-tables'
import { quoteIdentifier, toTimestampLiteral } from './sql-safety'
import { runInPartitionTransaction } from './transaction'

/**
 * Idempotent repair command for exactly one Observation parent + Dump Month
 * (docs/postgresql-migration-plan.md lines 713-739, 728-733: repair the DEFAULT partition by
 * moving only the rows that belong to one Dump Month into a real, exactly-bounded monthly RANGE
 * partition, preserving identity values, verifying row counts before committing).
 *
 * Everything happens inside one transaction protected by `runInPartitionTransaction`'s
 * transaction-scoped advisory lock, plus two explicit table locks taken immediately afterwards:
 * `SHARE UPDATE EXCLUSIVE` on the parent (the same mode `ATTACH PARTITION` itself takes, taken
 * early so the whole repair is serialized against concurrent DDL) and `SHARE ROW EXCLUSIVE` on
 * the DEFAULT partition (blocks concurrent INSERT/UPDATE/DELETE there while still allowing reads,
 * so no new matching rows can appear in the DEFAULT partition mid-repair).
 *
 * Three cases:
 *  1. No relation with the final partition name exists yet: create a standalone staging table
 *     (`CREATE TABLE ... (LIKE parent INCLUDING ALL)` plus an explicit exact-month `CHECK`
 *     constraint, so `ATTACH PARTITION` can validate it without a table scan), move the matching
 *     DEFAULT rows into it, then rename the staging table to its final name and attach it.
 *  2. A relation with the final name already exists and is an exact monthly partition of the
 *     expected parent: nothing to create or attach — move any leftover matching DEFAULT rows (if
 *     any re-appeared) directly into it. Handles "already repaired" safely, including a
 *     stray-rows-only re-run.
 *  3. A relation with the final name exists but is not an exact match (DEFAULT partition, wrong
 *     parent, or wrong bounds): reject immediately, before moving any data.
 *
 * Every count used for verification is read with `::text` so PostgreSQL's `bigint` `count(*)`
 * never needs a numeric-parsing type parser; every count is converted with `Number(...)` only
 * after being read back as a plain string.
 */

export interface RepairMonthlyPartitionOptions {
  readonly table: string
  readonly dumpMonth: string
}

export interface RepairMonthlyPartitionResult {
  readonly table: string
  readonly dumpMonth: string
  readonly partitionName: string
  readonly action: 'attached' | 'already-attached'
  readonly movedRowCount: number
}

const readCount = async (
  client: PartitionQueryClient,
  sql: string,
  values?: readonly unknown[],
): Promise<number> => {
  const result = await client.query(sql, values)
  const raw = result.rows[0]?.count
  const count = Number(raw)
  if (typeof raw !== 'string' || !Number.isInteger(count) || count < 0) {
    throw new PartitionMaintenanceError(
      `Expected a non-negative integer count, got: ${String(raw)}`,
    )
  }
  return count
}

export const repairMonthlyPartition = async (
  pool: PartitionPool,
  options: RepairMonthlyPartitionOptions,
): Promise<RepairMonthlyPartitionResult> => {
  // Fail fast on an unsafe table or a malformed Dump Month before opening any connection.
  assertObservationParentTable(options.table)
  const parts = parseDumpMonth(options.dumpMonth)
  const { table } = options
  const { lowerBoundUtc, upperBoundUtc } = computeDumpMonthBoundsUtc(parts)
  const expected: ExpectedMonthlyPartitionBounds = {
    parentTable: table,
    lowerBoundUtc,
    upperBoundUtc,
  }

  const partitionName = deriveMonthlyPartitionName(table, parts)
  const pendingName = derivePendingPartitionName(table, parts)
  const defaultName = deriveDefaultPartitionName(table)
  const pendingCheckConstraintName = `${pendingName}_dump_month_check`
  const lockKey = `poi-server:partition:${table}:${parts.text}`

  const defaultRangeSql =
    `select count(*)::text as count from only ${quoteIdentifier(defaultName)} ` +
    'where ingested_at >= $1 and ingested_at < $2'
  const rangeParams = [lowerBoundUtc, upperBoundUtc]

  const action = await runInPartitionTransaction(
    pool,
    lockKey,
    async (client: PartitionQueryClient) => {
      await client.query(`lock table ${quoteIdentifier(table)} in share update exclusive mode`)
      await client.query(`lock table ${quoteIdentifier(defaultName)} in share row exclusive mode`)

      const existing = await inspectPartitionCatalog(client, partitionName)

      let destinationName: string
      let isFreshStaging: boolean
      if (existing.relationExists) {
        assertExactMonthlyPartitionBounds(partitionName, existing, expected)
        destinationName = partitionName
        isFreshStaging = false
      } else {
        await client.query(`drop table if exists ${quoteIdentifier(pendingName)}`)
        await client.query(
          `create table ${quoteIdentifier(pendingName)} (like ${quoteIdentifier(table)} including all)`,
        )
        await client.query(
          `alter table ${quoteIdentifier(pendingName)} alter column id drop identity if exists`,
        )
        await client.query(
          `alter table ${quoteIdentifier(pendingName)} add constraint ${quoteIdentifier(pendingCheckConstraintName)} ` +
            `check (ingested_at >= ${toTimestampLiteral(lowerBoundUtc)} and ingested_at < ${toTimestampLiteral(upperBoundUtc)})`,
        )
        destinationName = pendingName
        isFreshStaging = true
      }

      const destinationCountSql = `select count(*)::text as count from only ${quoteIdentifier(destinationName)}`
      const destinationCountBefore = await readCount(client, destinationCountSql)
      const sourceCountBefore = await readCount(client, defaultRangeSql, rangeParams)

      let movedRowCount = 0
      if (sourceCountBefore > 0) {
        const moveSql = `
with moved_rows as (
  delete from only ${quoteIdentifier(defaultName)}
  where ingested_at >= $1 and ingested_at < $2
  returning *
), inserted_rows as (
  insert into ${quoteIdentifier(destinationName)} overriding system value
  select * from moved_rows
  returning 1
)
select
  (select count(*)::text from moved_rows) as deleted_count,
  (select count(*)::text from inserted_rows) as inserted_count
`.trim()
        const moveResult = await client.query(moveSql, rangeParams)
        const row = moveResult.rows[0]
        const deletedCount = Number(row?.deleted_count)
        const insertedCount = Number(row?.inserted_count)
        if (deletedCount !== sourceCountBefore || insertedCount !== sourceCountBefore) {
          throw new PartitionMaintenanceError(
            `Row move for "${table}" ${parts.text} was not exact: deleted ${String(row?.deleted_count)} from ` +
              `"${defaultName}" and inserted ${String(row?.inserted_count)} into "${destinationName}", expected ` +
              `exactly ${sourceCountBefore} of each`,
          )
        }
        movedRowCount = insertedCount
      }

      const remainingInDefault = await readCount(client, defaultRangeSql, rangeParams)
      if (remainingInDefault !== 0) {
        throw new PartitionMaintenanceError(
          `Default partition "${defaultName}" still has ${remainingInDefault} row(s) for ${parts.text} after the move`,
        )
      }

      const destinationCountAfter = await readCount(client, destinationCountSql)
      if (destinationCountAfter - destinationCountBefore !== movedRowCount) {
        throw new PartitionMaintenanceError(
          `Destination "${destinationName}" row count changed by ${destinationCountAfter - destinationCountBefore}, ` +
            `expected exactly ${movedRowCount}`,
        )
      }

      if (isFreshStaging) {
        await client.query(
          `alter table ${quoteIdentifier(pendingName)} rename to ${quoteIdentifier(partitionName)}`,
        )
        await client.query(
          `alter table ${quoteIdentifier(table)} attach partition ${quoteIdentifier(partitionName)} ` +
            `for values from (${toTimestampLiteral(lowerBoundUtc)}) to (${toTimestampLiteral(upperBoundUtc)})`,
        )
        await client.query(
          `alter table ${quoteIdentifier(partitionName)} drop constraint ${quoteIdentifier(pendingCheckConstraintName)}`,
        )
      }

      const final = await inspectPartitionCatalog(client, partitionName)
      assertExactMonthlyPartitionBounds(partitionName, final, expected)

      return {
        action: isFreshStaging ? ('attached' as const) : ('already-attached' as const),
        movedRowCount,
      }
    },
  )

  return {
    table,
    dumpMonth: parts.text,
    partitionName,
    action: action.action,
    movedRowCount: action.movedRowCount,
  }
}
