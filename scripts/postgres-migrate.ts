import 'dotenv/config'
import path from 'path'

import { config } from '../src/config'
import { migrateDatabase } from '../src/db/postgres/migrations'

export const formatMigrationError = (error: unknown, redactedValues: readonly string[]): string => {
  const message = error instanceof Error ? error.message : String(error)
  return redactedValues.reduce(
    (sanitized, value) =>
      value.length === 0 ? sanitized : sanitized.split(value).join('<redacted>'),
    message,
  )
}

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
