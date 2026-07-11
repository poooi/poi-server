import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

import { resolveDatabaseBackend } from '../backend'

type ApplyPostgresMigrations = (databaseUrl: string, migrationsFolder: string) => Promise<void>

const applyPostgresMigrations: ApplyPostgresMigrations = async (
  databaseUrl: string,
  migrationsFolder: string,
): Promise<void> => {
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

export const migrateDatabase = async (
  databaseUrl: string,
  migrationsFolder: string,
  applyPostgres: ApplyPostgresMigrations = applyPostgresMigrations,
) => {
  const backend = resolveDatabaseBackend(databaseUrl)
  if (backend === 'mongodb') {
    return backend
  }

  await applyPostgres(databaseUrl, migrationsFolder)
  return backend
}
