import childProcess from 'child_process'
import { trim } from 'lodash'
import mongoose from 'mongoose'
import { type Server } from 'http'

import { createApp } from './create-app'
import { isMongoDatabaseUrl, isSqliteDatabaseUrl, resolveDatabaseBackend } from './db/backend'
import {
  closeSqliteAppendOnlyStorage,
  initializeSqliteAppendOnlyStorage,
} from './db/sqlite/append-only'
import {
  closeSqliteOperationalStorage,
  initializeSqliteOperationalStorage,
} from './db/sqlite/operational'

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

const redactMongoCredentials = (message: string) =>
  message.replace(/(mongodb(?:\+srv)?:\/\/)([^:@/?#]+):([^@/?#]+)@/g, '$1<redacted>@')

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

export const connectDatabase = async (db: string) => {
  if (isSqliteDatabaseUrl(db)) {
    initializeSqliteOperationalStorage(db)
    initializeSqliteAppendOnlyStorage(db)
    return
  }
  if (!isMongoDatabaseUrl(db)) {
    throw new Error(`Unsupported database URL scheme: ${db}`)
  }

  try {
    await mongoose.connect(db, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      useCreateIndex: true,
    })
  } catch (err) {
    throw new Error(
      `Unable to connect to database: ${redactMongoCredentials(getErrorMessage(err))}`,
    )
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
  await connectDatabase(db)

  if (isMongoDatabaseUrl(db)) {
    mongoose.connection.on('error', (err: Error) => {
      throw new Error(
        `Unable to connect to database: ${redactMongoCredentials(getErrorMessage(err))}`,
      )
    })
  }

  const app = createApp({ backend, disableLogger })
  try {
    await app.listen({ host, port })
  } catch (err) {
    if (backend === 'sqlite') {
      closeSqliteAppendOnlyStorage()
      closeSqliteOperationalStorage()
    }
    throw err
  }
  const server: Server = app.server

  if (shouldLoadLatestCommit) {
    loadLatestCommit()
  }

  return {
    server,
    close: async () => {
      try {
        await app.close()
      } finally {
        if (backend === 'sqlite') {
          closeSqliteAppendOnlyStorage()
          closeSqliteOperationalStorage()
        }
      }
    },
  }
}
