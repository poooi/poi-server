import { type DumpPool, type DumpPoolClient } from './adapter'

/**
 * Minimal BEGIN ISOLATION LEVEL REPEATABLE READ / COMMIT / ROLLBACK / release boilerplate for the
 * Community Dump publish workflow's streaming export phase (docs/postgresql-migration-plan.md
 * line 745: "In one REPEATABLE READ transaction, for each of the nine tables..."). Deliberately
 * separate from `runInPartitionTransaction` (db/postgres/partitions/transaction.ts): `work` here
 * receives the full `DumpPoolClient` (including `streamQuery`), which that helper's callback
 * signature cannot express without an unsafe cast, and this seam takes no advisory lock — there
 * is no concurrent DDL to guard against during a read-only streaming export.
 *
 * `BEGIN ISOLATION LEVEL REPEATABLE READ` is issued as a single statement (rather than `BEGIN`
 * followed by a separate `SET TRANSACTION ISOLATION LEVEL ...`) so there is no window in which a
 * second statement could fail to be "the first statement of the transaction", which PostgreSQL
 * requires for `SET TRANSACTION`.
 *
 * Any rejection from `work` (or from `BEGIN` itself) rolls back the transaction and rethrows the
 * original error; the client is always released, on every path.
 */
export const runRepeatableReadDumpTransaction = async <T>(
  pool: DumpPool,
  work: (client: DumpPoolClient) => Promise<T>,
): Promise<T> => {
  const client = await pool.connect()
  try {
    await client.query('begin isolation level repeatable read')
    const result = await work(client)
    await client.query('commit')
    return result
  } catch (error) {
    try {
      await client.query('rollback')
    } catch {
      // The original error from `work` (or from BEGIN) is more actionable than a rollback
      // failure on an already-broken connection; never mask it.
    }
    throw error
  } finally {
    client.release()
  }
}
