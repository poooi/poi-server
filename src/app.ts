import { config } from './config'
import { startServer } from './server'

void startServer()
  .then(() => {
    console.log(`Koa is listening on port ${config.port}`)
  })
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
