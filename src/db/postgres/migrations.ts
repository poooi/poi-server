import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

import { resolveDatabaseBackend } from '../backend'

export const migratePostgres = async (
  databaseUrl: string,
  migrationsFolder: string,
): Promise<void> => {
  if (resolveDatabaseBackend(databaseUrl) !== 'postgresql') {
    throw new Error('PostgreSQL migrations require a postgres: or postgresql: database URL')
  }
  const pool = new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5000,
    max: 1,
  })
  try {
    await migrate(drizzle(pool), { migrationsFolder })
  } finally {
    await pool.end()
  }
}
