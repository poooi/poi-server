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
  parseDumpMonth,
} from './dump-month'
import { PartitionMaintenanceError } from './errors'
import { observationParentTables } from './observation-tables'
import { quoteIdentifier, toTimestampLiteral } from './sql-safety'
import { runInPartitionTransaction } from './transaction'

/**
 * Idempotent offline create-upcoming-month command for all nine Observation parents
 * (docs/postgresql-migration-plan.md lines 713-739, 725-727: "Create upcoming Dump Month
 * partitions before their boundary. Keep a default partition only as an alertable ingestion
 * safety net; rows in it indicate partition maintenance failure").
 *
 * For each of the nine allowlisted tables, in its own transaction:
 *  - if a relation with the derived monthly partition name already exists, it must be an exact
 *    match (attached directly to the parent, not the DEFAULT partition, exact JST-month UTC
 *    bounds) — an existing exact partition succeeds as a no-op, any mismatch fails loudly;
 *  - otherwise, the DEFAULT partition must have zero rows in the target month (this command is
 *    only for the simple "before the boundary" case; if the DEFAULT already has matching rows,
 *    it directs the operator to `repairMonthlyPartition` instead of attempting a row move here);
 *  - `CREATE TABLE ... PARTITION OF ... FOR VALUES FROM (...) TO (...)` creates and attaches the
 *    partition atomically, then the catalog is re-verified before commit.
 *
 * One table's failure does not stop the others: every table is attempted, and any failures are
 * reported together in a single aggregated error so a rerun only needs to fix the tables that
 * actually failed (the command is safe to rerun as many times as needed).
 */

export interface CreateUpcomingMonthPartitionOutcome {
  readonly table: string
  readonly partitionName: string
  readonly action: 'created' | 'already-exact'
}

const createSinglePartition = (
  pool: PartitionPool,
  table: string,
  dumpMonth: string,
): Promise<CreateUpcomingMonthPartitionOutcome> => {
  const parts = parseDumpMonth(dumpMonth)
  const { lowerBoundUtc, upperBoundUtc } = computeDumpMonthBoundsUtc(parts)
  const expected: ExpectedMonthlyPartitionBounds = {
    parentTable: table,
    lowerBoundUtc,
    upperBoundUtc,
  }
  const partitionName = deriveMonthlyPartitionName(table, parts)
  const defaultName = deriveDefaultPartitionName(table)
  const lockKey = `poi-server:partition:${table}:${parts.text}`

  return runInPartitionTransaction(pool, lockKey, async (client: PartitionQueryClient) => {
    const existing = await inspectPartitionCatalog(client, partitionName)
    if (existing.relationExists) {
      assertExactMonthlyPartitionBounds(partitionName, existing, expected)
      return { table, partitionName, action: 'already-exact' as const }
    }

    const conflict = await client.query(
      `select 1 from only ${quoteIdentifier(defaultName)} where ingested_at >= $1 and ingested_at < $2 limit 1`,
      [lowerBoundUtc, upperBoundUtc],
    )
    if (conflict.rows.length > 0) {
      throw new PartitionMaintenanceError(
        `Default partition "${defaultName}" already has rows for ${parts.text}; run the partition-repair ` +
          `command for "${table}" ${parts.text} instead of create-upcoming-month`,
      )
    }

    await client.query(
      `create table ${quoteIdentifier(partitionName)} partition of ${quoteIdentifier(table)} ` +
        `for values from (${toTimestampLiteral(lowerBoundUtc)}) to (${toTimestampLiteral(upperBoundUtc)})`,
    )

    const created = await inspectPartitionCatalog(client, partitionName)
    assertExactMonthlyPartitionBounds(partitionName, created, expected)

    return { table, partitionName, action: 'created' as const }
  })
}

export const createUpcomingMonthPartitions = async (
  pool: PartitionPool,
  dumpMonth: string,
): Promise<readonly CreateUpcomingMonthPartitionOutcome[]> => {
  // Fail fast on a malformed Dump Month before opening any database connection.
  parseDumpMonth(dumpMonth)

  const outcomes: CreateUpcomingMonthPartitionOutcome[] = []
  const failures: string[] = []
  for (const table of observationParentTables) {
    try {
      outcomes.push(await createSinglePartition(pool, table, dumpMonth))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push(`${table}: ${message}`)
    }
  }

  if (failures.length > 0) {
    throw new PartitionMaintenanceError(
      `Failed to create ${dumpMonth} partitions for ${failures.length} of ${observationParentTables.length} ` +
        `table(s):\n${failures.join('\n')}`,
    )
  }
  return outcomes
}
