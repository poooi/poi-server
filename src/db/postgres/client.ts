import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

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
