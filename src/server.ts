import childProcess from 'child_process'
import { trim } from 'lodash'
import mongoose from 'mongoose'
import { type Server } from 'http'

import { createApp } from './create-app'
import { captureException } from './sentry'

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
  await mongoose.connect(db, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    useCreateIndex: true,
  })
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
    throw new Error(`Unable to connect to database at ${db}: ${err.message}`)
  })

  const app = createApp({ disableLogger })
  app.on('error', captureException)

  const server = await new Promise<Server>((resolve, reject) => {
    const listener = app.listen(port, host)

    function cleanup() {
      listener.off('error', onError)
      listener.off('listening', onListening)
    }

    function onError(err: Error) {
      cleanup()
      reject(err)
    }

    function onListening() {
      cleanup()
      resolve(listener)
    }

    listener.once('error', onError)
    listener.once('listening', onListening)
  })

  if (shouldLoadLatestCommit) {
    loadLatestCommit()
  }

  return {
    server,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => {
          if (err != null) {
            reject(err)
            return
          }
          resolve()
        })
      }),
  }
}
