import { config } from './config'
import { startServer } from './server'

void startServer({
  db: config.db,
  disableLogger: Boolean(config.disableLogger),
  host: '127.0.0.1',
  loadLatestCommit: true,
  port: config.port,
})
  .then(() => {
    console.log(`Fastify is listening on port ${config.port}`)
  })
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
