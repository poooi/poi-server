const ChildProcess = require('child_process')
const Fastify = require('fastify')

require('dotenv').config()

const defaultPort = 11280
const defaultHost = '127.0.0.1'

const runMasterHook = () => {
  console.log(`====================Master hook ${new Date()} ====================`)
  const cp = ChildProcess.spawn('./github-master-hook', [], {
    stdio: 'inherit',
  })
  cp.on('error', (err) => console.error('* Master hook spawn error:', err))
  cp.on('close', (code) => console.log('* Master hook exit code:' + code))
}

const createHookApp = ({ runHook = runMasterHook } = {}) => {
  const app = Fastify({ logger: false })

  app.post('/api/github-master-hook', async (_request, reply) => {
    runHook()
    return reply.type('text/plain; charset=utf-8').send('ok')
  })

  app.setNotFoundHandler(async (_request, reply) =>
    reply.code(404).type('text/plain; charset=utf-8').send('not found'),
  )

  return app
}

if (require.main === module) {
  const app = createHookApp()
  app
    .listen({ host: defaultHost, port: defaultPort })
    .then(() => {
      console.log(`Server is listening at port ${defaultPort}`)
    })
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}

module.exports = {
  createHookApp,
  defaultHost,
  defaultPort,
  runMasterHook,
}
