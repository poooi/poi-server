import 'dotenv/config'

import { config } from '../src/config'
import { runMonthlyDump } from '../src/db/dump'
import { closePostgresDb } from '../src/db/postgres'

const parseTargetMonth = (): string | undefined => {
  const targetMonth = process.argv[2]
  return targetMonth == null || targetMonth === '' ? undefined : targetMonth
}

const main = async () => {
  const result = await runMonthlyDump(config.db, {
    outputDir: config.dumpDir,
    targetMonth: parseTargetMonth(),
  })

  console.log(`Monthly dump ${result.dumpMonth} -> ${result.outputDir}`)
  for (const table of result.tables) {
    const details =
      table.status === 'dumped'
        ? `rows=${table.rowCount} checksum=${table.checksum} file=${table.outputLocation}`
        : table.status === 'failed'
          ? table.error
          : `rows=${table.rowCount}`
    console.log(`${table.tableName}: ${table.status}${details == null ? '' : ` (${details})`}`)
  }

  const hasFailure = result.tables.some((table) => table.status === 'failed')
  process.exitCode = hasFailure ? 1 : 0
}

void main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    await closePostgresDb()
  })
