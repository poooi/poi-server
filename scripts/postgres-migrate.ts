import 'dotenv/config'
import path from 'path'

import { config } from '../src/config'
import { migrateDatabase } from '../src/db/postgres/migrations'

void migrateDatabase(config.db, path.resolve(config.root, '../drizzle'))
  .then((backend) => {
    if (backend === 'postgresql') {
      console.log('PostgreSQL migrations completed')
    } else {
      console.log('MongoDB requires no database migrations')
    }
  })
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
