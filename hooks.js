const ChildProcess = require('child_process')
const http = require('http')

require('dotenv').config()

const defaultPort = 11280
const defaultHost = '127.0.0.1'

const send = (res, statusCode, body = '') => {
  res.writeHead(statusCode, {
    'content-length': Buffer.byteLength(body),
    'content-type': 'text/plain; charset=utf-8',
  })
  res.end(body)
}

const runMasterHook = () => {
  console.log(`====================Master hook ${new Date()} ====================`)
  const cp = ChildProcess.spawn('./github-master-hook', [], {
    stdio: 'inherit',
  })
  cp.on('error', (err) => console.error('* Master hook spawn error:', err))
  cp.on('close', (code) => console.log('* Master hook exit code:' + code))
}

const createHookServer = ({ runHook = runMasterHook } = {}) =>
  http.createServer((req, res) => {
    let path
    try {
      path = new URL(req.url || '/', `http://${defaultHost}:${defaultPort}`).pathname
    } catch {
      send(res, 400, 'bad request')
      return
    }

    if (req.method === 'POST' && path === '/api/github-master-hook') {
      runHook()
      send(res, 200, 'ok')
      return
    }

    send(res, 404, 'not found')
  })

if (require.main === module) {
  const server = createHookServer()
  server.listen(defaultPort, defaultHost, () => {
    console.log(`Server is listening at port ${defaultPort}`)
  })
}

module.exports = {
  createHookServer,
  defaultHost,
  defaultPort,
  runMasterHook,
}
