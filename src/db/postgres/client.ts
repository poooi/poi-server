import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool, type PoolConfig } from 'pg'

import { type DataEpoch } from '../../contracts/database'
import { redactDatabaseUrl } from '../backend'
import { verifyPostgresDatabase } from './lifecycle'
import * as schema from './schema'

export interface PostgresDatabase {
  db: NodePgDatabase<typeof schema>
  epoch: DataEpoch
  pool: Pool
}

export const createPostgresPool = (databaseUrl: string, max = 10): Pool =>
  new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    max,
    options: '-c statement_timeout=10000 -c transaction_timeout=10000',
  })

/**
 * Pool configuration for the Community Dump publish/cleanup offline export path
 * (docs/postgresql-migration-plan.md lines 622-811). Deliberately separate from
 * `createPostgresPool`'s API-request pool: the export phase streams whole monthly Observation
 * partitions and must not be killed by the API pool's 10s `statement_timeout`/`transaction_timeout`
 * — there is no such thing as "too long" for a background export, only "too long holding a lock".
 * `lock_timeout` is kept short so a stuck or conflicting DDL statement elsewhere (partition
 * maintenance, a repair run) fails fast and visibly rather than the export hanging indefinitely
 * waiting to acquire a lock it may never get. `application_name` is set so this connection is
 * identifiable in `pg_stat_activity`/logs as offline dump tooling, distinct from API traffic.
 *
 * Exported as a pure function (rather than folding the object literal directly into
 * `createOfflineDumpPool`) specifically so unit tests can assert on every option value without
 * opening a real database connection (see tests/postgres-offline-dump-pool.test.ts).
 */
export const buildOfflineDumpPoolConfig = (databaseUrl: string, max = 3): PoolConfig => ({
  connectionString: databaseUrl,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  max,
  application_name: 'poi-server-dump-offline',
  lock_timeout: 10000,
})

/**
 * A pg `Pool` dedicated to the offline Community Dump publish/cleanup CLI commands
 * (scripts/postgres-dump-publish.ts, scripts/postgres-dump-cleanup.ts), always separate from
 * `createPostgresPool`'s API-request pool — see {@link buildOfflineDumpPoolConfig} for why.
 */
export const createOfflineDumpPool = (databaseUrl: string, max = 3): Pool =>
  new Pool(buildOfflineDumpPoolConfig(databaseUrl, max))

export const connectPostgres = async (databaseUrl: string, max = 10): Promise<PostgresDatabase> => {
  const pool = createPostgresPool(databaseUrl, max)
  try {
    const epoch = await verifyPostgresDatabase(pool)
    return {
      db: drizzle(pool, { schema }),
      epoch,
      pool,
    }
  } catch (error) {
    await pool.end()
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Unable to initialize PostgreSQL database ${redactDatabaseUrl(databaseUrl)}: ${message}`,
    )
  }
}
