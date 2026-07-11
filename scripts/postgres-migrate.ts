import 'dotenv/config'
import path from 'path'

import { config } from '../src/config'
import { migratePostgres } from '../src/db/postgres/migrations'

void migratePostgres(config.db, path.resolve(config.root, '../drizzle')).catch((error) => {
  console.error(error)
  process.exitCode = 1
})
