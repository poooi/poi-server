const childProcess = require('child_process')

const port = 17927
const baseUrl = `http://127.0.0.1:${port}`

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const waitFor = async (probe, timeoutMs) => {
  const startedAt = Date.now()
  let lastError
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await probe()
      if (result) {
        return result
      }
    } catch (err) {
      lastError = err
    }
    await sleep(500)
  }
  throw lastError || new Error('Timed out waiting for smoke check')
}

const getStatus = async () => {
  const response = await fetch(`${baseUrl}/api/status`)
  if (!response.ok) {
    throw new Error(`Unexpected ${response.status} from /api/status`)
  }
  const body = await response.json()
  if (!body || !body.mongo || typeof body.mongo.Quest !== 'number') {
    throw new Error('Unexpected /api/status payload')
  }
  return body
}

const waitForStatus = () => waitFor(getStatus, 30000)

const postQuest = async () => {
  const response = await fetch(`${baseUrl}/api/report/v3/quest`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-reporter': 'smoke-test',
    },
    body: JSON.stringify({
      data: {
        quests: [
          {
            questId: 999001,
            title: 'Smoke Test Quest',
            detail: `smoke-${Date.now()}`,
            category: 1,
            type: 1,
          },
        ],
      },
    }),
  })

  if (!response.ok) {
    throw new Error(`Unexpected ${response.status} from quest report`)
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

waitForStatus()
  .then(async (initialStatus) => {
    const initialQuestCount = initialStatus.mongo.Quest
    await postQuest()
    await waitFor(async () => {
      const status = await getStatus()
      return status.mongo.Quest > initialQuestCount ? status : undefined
    }, 30000)
    cleanup()
  })
  .catch((err) => {
    console.error(err)
    cleanup()
    process.exitCode = 1
  })
