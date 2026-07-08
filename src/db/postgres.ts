import path from 'path'

import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

import { redactConnectionCredentials, resolveBackend } from './backend'
import * as schema from './schema/postgres'

const getErrorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err))

let pool: Pool | null = null
let db: NodePgDatabase<typeof schema> | null = null
let currentDatabaseUrl: string | null = null

const getPostgresPool = (databaseUrl: string): Pool => {
  if (resolveBackend(databaseUrl) !== 'postgres') {
    throw new Error(
      `PostgreSQL database URL is required: ${redactConnectionCredentials(databaseUrl)}`,
    )
  }

  if (pool == null) {
    pool = new Pool({
      connectionString: databaseUrl,
    })
    db = drizzle(pool, { schema })
    currentDatabaseUrl = databaseUrl
  } else if (currentDatabaseUrl !== databaseUrl) {
    throw new Error('PostgreSQL database pool already initialized with a different URL')
  }

  return pool
}

export const getPostgresDb = (databaseUrl: string): NodePgDatabase<typeof schema> => {
  getPostgresPool(databaseUrl)
  return db as NodePgDatabase<typeof schema>
}

export const verifyPostgresConnection = async (databaseUrl: string): Promise<void> => {
  try {
    await getPostgresPool(databaseUrl).query('select 1')
  } catch (err) {
    throw new Error(
      `Unable to connect to database: ${redactConnectionCredentials(databaseUrl)} (${getErrorMessage(err)})`,
    )
  }
}

export const runPostgresMigrations = async (databaseUrl: string): Promise<void> => {
  try {
    await migrate(getPostgresDb(databaseUrl), {
      migrationsFolder: path.resolve(__dirname, '../../migrations/postgres'),
    })
  } catch (err) {
    throw new Error(
      `Unable to run PostgreSQL migrations: ${redactConnectionCredentials(databaseUrl)} (${getErrorMessage(err)})`,
    )
  }
}

export const closePostgresDb = async (): Promise<void> => {
  if (pool != null) {
    await pool.end()
  }

  pool = null
  db = null
  currentDatabaseUrl = null
}
