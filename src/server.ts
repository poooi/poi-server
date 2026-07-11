import childProcess from 'child_process'
import { trim } from 'lodash'
import mongoose from 'mongoose'
import { type Server } from 'http'

import { createApp } from './create-app'
import { createPostgresDatabaseStatus } from './controllers/api/others.postgres.status'
import { createPostgresV2Actions } from './controllers/api/report/v2.postgres.actions'
import { createPostgresV3Actions } from './controllers/api/report/v3.postgres.actions'
import { redactDatabaseUrl, resolveDatabaseBackend } from './db/backend'
import { connectPostgres } from './db/postgres/client'

interface StartServerOptions {
  db: string
  disableLogger: boolean
  host: string
  loadLatestCommit: boolean
  port: number
}

interface StartedServer {
  server: Server
  close: () => Promise<void>
}

const getErrorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err))

export const loadLatestCommit = () => {
  childProcess.exec('git rev-parse HEAD', (err, stdout) => {
    if (!err) {
      global.latestCommit = trim(stdout)
    } else {
      console.error(err)
    }
  })
}

export const connectMongo = async (db: string) => {
  try {
    await mongoose.connect(db, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      useCreateIndex: true,
    })
  } catch (err) {
    throw new Error(
      `Unable to connect to database: ${redactDatabaseUrl(db)}: ${getErrorMessage(err)}`,
    )
  }
}

const startMongoServer = async ({
  db,
  disableLogger,
  host,
  port,
}: Omit<StartServerOptions, 'loadLatestCommit'>): Promise<StartedServer> => {
  await connectMongo(db)

  mongoose.connection.on('error', (err: Error) => {
    throw new Error(
      `Unable to connect to database: ${redactDatabaseUrl(db)}: ${getErrorMessage(err)}`,
    )
  })

  const app = createApp({ disableLogger })
  await app.listen({ host, port })

  return {
    server: app.server,
    close: () => app.close(),
  }
}

const startPostgresServer = async ({
  db,
  disableLogger,
  host,
  port,
}: Omit<StartServerOptions, 'loadLatestCommit'>): Promise<StartedServer> => {
  // connectPostgres never auto-migrates; it only verifies the schema version.
  const postgres = await connectPostgres(db)

  const app = createApp({
    disableLogger,
    getDatabaseStatus: createPostgresDatabaseStatus(postgres.db),
    reportV2Actions: createPostgresV2Actions(postgres.db),
    reportV3Actions: createPostgresV3Actions(postgres.db),
  })
  try {
    await app.listen({ host, port })
  } catch (error) {
    await postgres.pool.end()
    throw error
  }

  return {
    server: app.server,
    close: async () => {
      await app.close()
      await postgres.pool.end()
    },
  }
}

export const startServer = async ({
  db,
  disableLogger,
  host,
  loadLatestCommit: shouldLoadLatestCommit,
  port,
}: StartServerOptions): Promise<StartedServer> => {
  const backend = resolveDatabaseBackend(db)
  const started =
    backend === 'postgresql'
      ? await startPostgresServer({ db, disableLogger, host, port })
      : await startMongoServer({ db, disableLogger, host, port })

  if (shouldLoadLatestCommit) {
    loadLatestCommit()
  }

  return started
}
