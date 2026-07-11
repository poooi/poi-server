import 'dotenv/config'

import { runR2ConnectionCheckCommand } from '../src/cli/r2-connection-check-command'

void runR2ConnectionCheckCommand(process.argv.slice(2), process.env)
  .then((result) => console.log(JSON.stringify(result, null, 2)))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
