import ChildProcess from 'child_process'
import Fastify, { type FastifyInstance } from 'fastify'

import 'dotenv/config'

export const defaultPort = 11280
export const defaultHost = '127.0.0.1'

interface CreateHookAppOptions {
  runHook?: () => void
}

export const runMasterHook = () => {
  console.log(`====================Master hook ${new Date()} ====================`)
  const cp = ChildProcess.spawn('./github-master-hook', [], {
    stdio: 'inherit',
  })
  cp.on('error', (err) => console.error('* Master hook spawn error:', err))
  cp.on('close', (code) => console.log('* Master hook exit code:' + code))
}

export const createHookApp = ({
  runHook = runMasterHook,
}: CreateHookAppOptions = {}): FastifyInstance => {
  const app = Fastify({ logger: false })

  app.post('/api/github-master-hook', async (_request, reply) => {
    runHook()
    return reply.code(200).send()
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
