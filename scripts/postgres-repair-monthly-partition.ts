import 'dotenv/config'

import { config } from '../src/config'
import { resolveDatabaseBackend } from '../src/db/backend'
import { createPostgresPool } from '../src/db/postgres/client'
import { repairMonthlyPartition } from '../src/db/postgres/partitions/repair-monthly-partition'

const table = process.argv[2]
const dumpMonth = process.argv[3]
if (table == null || dumpMonth == null) {
  console.error('Usage: npm run db:partitions:repair -- <table> <YYYY-MM>')
  console.error(
    "Moves the rows for one Japan Standard Time Dump Month out of <table>'s DEFAULT partition " +
      'and into a real, exactly-bounded monthly RANGE partition. <table> must be one of the nine ' +
      'allowlisted Observation parent tables. Safe to rerun: an already-repaired exact partition ' +
      'is a no-op other than moving any leftover matching rows.',
  )
  process.exitCode = 1
} else if (resolveDatabaseBackend(config.db) !== 'postgresql') {
  console.error(
    'Partition maintenance requires a postgres: or postgresql: database URL (POI_SERVER_DATABASE_URL)',
  )
  process.exitCode = 1
} else {
  const pool = createPostgresPool(config.db, 1)
  void repairMonthlyPartition(pool, { table, dumpMonth })
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    })
    .finally(() => pool.end())
}
