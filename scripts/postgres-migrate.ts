import 'dotenv/config'
import path from 'path'

import { config } from '../src/config'
import { formatMigrationError } from '../src/db/postgres/migration-error'
import { migrateDatabase } from '../src/db/postgres/migrations'

if (require.main === module) {
  const migrationsFolder = path.resolve(config.root, '../drizzle')

  void migrateDatabase(config.db, migrationsFolder)
    .then((backend) => {
      if (backend === 'postgresql') {
        console.log('PostgreSQL migrations completed')
      } else {
        console.log('MongoDB requires no database migrations')
      }
    })
    .catch((error) => {
      console.error(formatMigrationError(error, [config.root, migrationsFolder, config.db]))
      process.exitCode = 1
    })
}
