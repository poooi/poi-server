import { type PartitionPool, type PartitionQueryClient } from './adapter'

/**
 * Shared BEGIN / transaction-scoped-advisory-lock / COMMIT / ROLLBACK / release boilerplate for
 * the Community Dump partition maintenance/repair seam (docs/postgresql-migration-plan.md lines
 * 713-739). `advisoryLockKey` is hashed by PostgreSQL's own `hashtextextended`, so callers pass a
 * plain descriptive string (for example `poi-server:partition:<table>:<dumpMonth>`) rather than
 * computing a numeric key themselves; PostgreSQL releases `pg_advisory_xact_lock` automatically
 * at COMMIT or ROLLBACK, which is exactly the transaction-scoped lock the plan requires.
 *
 * `work` may issue any additional statements it needs (for example the explicit table locks the
 * repair command takes) after the advisory lock and before COMMIT. Any rejection from `work`
 * (or from acquiring the advisory lock) rolls back the transaction and rethrows the original
 * error; the client is always released, on every path.
 */
export const runInPartitionTransaction = async <T>(
  pool: PartitionPool,
  advisoryLockKey: string,
  work: (client: PartitionQueryClient) => Promise<T>,
): Promise<T> => {
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [advisoryLockKey])
    const result = await work(client)
    await client.query('commit')
    return result
  } catch (error) {
    try {
      await client.query('rollback')
    } catch {
      // The original error from `work` (or from acquiring the lock) is more actionable than a
      // rollback failure on an already-broken connection; never mask it.
    }
    throw error
  } finally {
    client.release()
  }
}
