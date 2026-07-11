import 'dotenv/config'
import { randomUUID } from 'crypto'
import { Pool } from 'pg'

import { config } from '../src/config'
import { resolveDatabaseBackend } from '../src/db/backend'
import { createDataEpoch } from '../src/db/postgres/lifecycle'

const startedAtText = process.argv[2]
if (startedAtText == null) {
  console.error('Usage: npm run db:create-epoch -- <ISO-8601 cutover timestamp> [UUID]')
  process.exitCode = 1
} else if (resolveDatabaseBackend(config.db) !== 'postgresql') {
  console.error('Data Epoch creation requires a postgres: or postgresql: database URL')
  process.exitCode = 1
} else {
  const pool = new Pool({
    connectionString: config.db,
    connectionTimeoutMillis: 5000,
    max: 1,
  })
  void createDataEpoch(pool, {
    id: process.argv[3] || randomUUID(),
    startedAt: new Date(startedAtText),
  })
    .then((epoch) => console.log(JSON.stringify(epoch)))
    .catch((error) => {
      console.error(error)
      process.exitCode = 1
    })
    .finally(() => pool.end())
}
