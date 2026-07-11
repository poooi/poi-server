import 'dotenv/config'

import { runCleanupDumpRunCommand } from '../src/cli/postgres-dump-cleanup-command'

void runCleanupDumpRunCommand(process.argv.slice(2), process.env)
  .then((result) => console.log(JSON.stringify(result, null, 2)))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
