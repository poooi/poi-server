import 'dotenv/config'

import { runPublishDumpMonthCommand } from '../src/cli/postgres-dump-publish-command'

void runPublishDumpMonthCommand(process.argv.slice(2), process.env)
  .then((result) => console.log(JSON.stringify(result, null, 2)))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
