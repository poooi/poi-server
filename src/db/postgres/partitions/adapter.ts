/**
 * Testable adapter around `pg`'s `Pool`/`PoolClient`. The Community Dump partition
 * maintenance/repair seam (docs/postgresql-migration-plan.md lines 713-739) depends only on
 * these minimal structural interfaces, never on `pg`'s concrete classes, so unit tests can
 * supply plain fake objects (see tests/partition-transaction.test.ts,
 * tests/partition-create-upcoming-month.test.ts, tests/partition-repair-monthly-partition.test.ts)
 * without importing `pg` or a real PostgreSQL connection.
 *
 * `pg.Pool` and the `PoolClient` returned by `pg.Pool#connect()` already satisfy these
 * interfaces structurally (see src/db/postgres/lifecycle.ts's identical `PostgresQueryClient`
 * seam for the existing precedent), so production code passes a real `Pool` directly with no
 * wrapper and no cast.
 */

export interface PartitionQueryResult {
  readonly rows: ReadonlyArray<Record<string, unknown>>
  readonly rowCount: number | null
}

export interface PartitionQueryClient {
  query: (text: string, values?: readonly unknown[]) => Promise<PartitionQueryResult>
}

export interface PartitionPoolClient extends PartitionQueryClient {
  release: (err?: Error | boolean) => void
}

export interface PartitionPool {
  connect: () => Promise<PartitionPoolClient>
}
