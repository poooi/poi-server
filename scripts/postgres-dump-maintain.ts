import 'dotenv/config'

import { runDumpMaintenanceCommand } from '../src/cli/postgres-dump-maintenance-command'

void runDumpMaintenanceCommand(process.argv.slice(2), process.env)
  .then((result) => console.log(JSON.stringify(result, null, 2)))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
