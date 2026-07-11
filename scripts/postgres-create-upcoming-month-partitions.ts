import 'dotenv/config'

import { config } from '../src/config'
import { resolveDatabaseBackend } from '../src/db/backend'
import { createUpcomingMonthPartitions } from '../src/db/postgres/partitions/create-upcoming-month'
import { createPostgresPool } from '../src/db/postgres/client'

const dumpMonth = process.argv[2]
if (dumpMonth == null) {
  console.error('Usage: npm run db:partitions:create-upcoming -- <YYYY-MM>')
  console.error(
    'Creates, for all nine Observation parent tables, the RANGE partition covering the given ' +
      'Japan Standard Time Dump Month. Safe to rerun: an existing exact partition is a no-op.',
  )
  process.exitCode = 1
} else if (resolveDatabaseBackend(config.db) !== 'postgresql') {
  console.error(
    'Partition maintenance requires a postgres: or postgresql: database URL (POI_SERVER_DATABASE_URL)',
  )
  process.exitCode = 1
} else {
  const pool = createPostgresPool(config.db, 1)
  void createUpcomingMonthPartitions(pool, dumpMonth)
    .then((outcomes) => console.log(JSON.stringify(outcomes, null, 2)))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    })
    .finally(() => pool.end())
}
