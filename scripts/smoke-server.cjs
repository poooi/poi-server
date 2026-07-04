const childProcess = require('child_process')

const port = 17927
const baseUrl = `http://127.0.0.1:${port}`
const smokeCommit = 'smoke-commit'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const waitForStatus = async (url, timeoutMs) => {
  const startedAt = Date.now()
  let lastError
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        const body = await response.json()
        if (body && body.mongo && typeof body.mongo.Quest === 'number') {
          return
        }
        lastError = new Error(`Unexpected status payload from ${url}`)
      } else {
        lastError = new Error(`Unexpected ${response.status} from ${url}`)
      }
    } catch (err) {
      lastError = err
    }
    await sleep(500)
  }
  throw lastError || new Error(`Timed out waiting for ${url}`)
}

const assertLatestCommit = async () => {
  const response = await fetch(`${baseUrl}/api/latest-commit`)
  if (!response.ok) {
    throw new Error(`Unexpected ${response.status} from /api/latest-commit`)
  }
  const body = await response.text()
  if (body !== smokeCommit) {
    throw new Error(`Unexpected latest commit: ${body}`)
  }
}

const server = childProcess.spawn('node', ['index.js'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'test',
    POI_SERVER_PORT: String(port),
    POI_SERVER_DB: 'mongodb://127.0.0.1:27017/poi-smoke',
    POI_SERVER_DISABLE_LOGGER: '1',
    POI_SERVER_COMMIT: smokeCommit,
  },
})

let cleanedUp = false
const cleanup = () => {
  if (cleanedUp) {
    return
  }
  cleanedUp = true
  if (!server.killed) {
    server.kill('SIGTERM')
  }
}

process.on('exit', cleanup)
process.on('SIGINT', () => {
  cleanup()
  process.exit(130)
})
process.on('SIGTERM', () => {
  cleanup()
  process.exit(143)
})

waitForStatus(`${baseUrl}/api/status`, 30000)
  .then(async () => {
    await assertLatestCommit()
    cleanup()
  })
  .catch((err) => {
    console.error(err)
    cleanup()
    process.exitCode = 1
  })
