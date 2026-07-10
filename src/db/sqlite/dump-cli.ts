import {
  exportAppendOnlyMonth,
  removeValidatedAppendOnlyMonth,
  type AppendOnlyDumpResult,
} from './dump'

interface DumpCliOptions {
  appendOnlyDir: string
  cleanup: boolean
  month: string
  outputDir: string
}

const parseArgs = (args: string[]): DumpCliOptions => {
  const options: Partial<DumpCliOptions> = {
    cleanup: false,
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--cleanup') {
      options.cleanup = true
      continue
    }
    const value = args[index + 1]
    if (value == null) {
      throw new Error(`Missing value for ${arg}`)
    }
    if (arg === '--append-only-dir') {
      options.appendOnlyDir = value
    } else if (arg === '--month') {
      options.month = value
    } else if (arg === '--output-dir') {
      options.outputDir = value
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
    index += 1
  }

  if (options.appendOnlyDir == null || options.month == null || options.outputDir == null) {
    throw new Error(
      'Usage: tsx src/db/sqlite/dump-cli.ts --append-only-dir <dir> --month <YYYY-MM> --output-dir <dir> [--cleanup]',
    )
  }

  return options as DumpCliOptions
}

export const runAppendOnlyDumpCli = async (
  args = process.argv.slice(2),
): Promise<AppendOnlyDumpResult> => {
  const options = parseArgs(args)
  const dump = await exportAppendOnlyMonth(options)
  if (options.cleanup) {
    await removeValidatedAppendOnlyMonth({
      appendOnlyDir: options.appendOnlyDir,
      dump,
    })
  }
  return dump
}

if (require.main === module) {
  runAppendOnlyDumpCli()
    .then((dump) => {
      console.log(JSON.stringify(dump, null, 2))
    })
    .catch((err) => {
      console.error(err)
      process.exitCode = 1
    })
}
