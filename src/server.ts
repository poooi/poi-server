import childProcess from 'child_process'
import { trim } from 'lodash'
import mongoose from 'mongoose'
import { type Server } from 'http'

import { createApp } from './create-app'
import {
  redactDatabaseCredentials,
  resolveDatabaseBackend,
  type DatabaseBackend,
} from './db/backend'

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

const connectMongoDatabase = async (db: string) => {
  try {
    await mongoose.connect(db, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      useCreateIndex: true,
    })
  } catch (err) {
    throw new Error(
      `Unable to connect to database: ${redactDatabaseCredentials(getErrorMessage(err))}`,
    )
  }
}

const connectPostgresDatabase = async (db: string) => {
  throw new Error(
    `Unable to connect to database: PostgreSQL backend is not implemented yet for ${redactDatabaseCredentials(db)}`,
  )
}

export const connectDatabase = async (db: string) => {
  const backend: DatabaseBackend = resolveDatabaseBackend(db)
  if (backend === 'mongo') {
    await connectMongoDatabase(db)
    return
  }

  await connectPostgresDatabase(db)
}

export const startServer = async ({
  db,
  disableLogger,
  host,
  loadLatestCommit: shouldLoadLatestCommit,
  port,
}: StartServerOptions): Promise<StartedServer> => {
  await connectDatabase(db)

  mongoose.connection.on('error', (err: Error) => {
    throw new Error(
      `Unable to connect to database: ${redactDatabaseCredentials(getErrorMessage(err))}`,
    )
  })

  const app = createApp({ disableLogger })
  await app.listen({ host, port })
  const server: Server = app.server

  if (shouldLoadLatestCommit) {
    loadLatestCommit()
  }

  return {
    server,
    close: () => app.close(),
  }
}
