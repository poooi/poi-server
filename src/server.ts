import childProcess from 'child_process'
import { trim } from 'lodash'
import mongoose from 'mongoose'
import { type Server } from 'http'

import { createApp } from './create-app'
import { redactConnectionCredentials, resolveBackend } from './db/backend'
import { closePostgresDb, runPostgresMigrations, verifyPostgresConnection } from './db/postgres'

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

export const connectDatabase = async (db: string) => {
  try {
    await mongoose.connect(db, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      useCreateIndex: true,
    })
  } catch (err) {
    throw new Error(
      `Unable to connect to database: ${redactConnectionCredentials(getErrorMessage(err))}`,
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
  const backend = resolveBackend(db)

  if (backend === 'postgres') {
    await verifyPostgresConnection(db)
    await runPostgresMigrations(db)
  } else {
    await connectDatabase(db)

    mongoose.connection.on('error', (err: Error) => {
      throw new Error(
        `Unable to connect to database: ${redactConnectionCredentials(getErrorMessage(err))}`,
      )
    })
  }

  const app = createApp({ disableLogger })
  await app.listen({ host, port })
  const server: Server = app.server

  if (shouldLoadLatestCommit) {
    loadLatestCommit()
  }

  return {
    server,
    close: async () => {
      await app.close()
      if (backend === 'postgres') {
        await closePostgresDb()
      } else {
        await mongoose.disconnect()
      }
    },
  }
}
