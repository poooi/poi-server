import {
  exportAppendOnlyMonth,
  removeManifestValidatedAppendOnlyMonth,
  type AppendOnlyDumpResult,
} from './dump'

interface DumpCliOptions {
  appendOnlyDir: string
  confirmLocalDelete: boolean
  cleanup: boolean
  manifestPath?: string
  month?: string
  outputDir?: string
  verifiedManifestSha256?: string
}

const parseArgs = (args: string[]): DumpCliOptions => {
  const options: Partial<DumpCliOptions> = {
    confirmLocalDelete: false,
    cleanup: false,
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--cleanup') {
      options.cleanup = true
      continue
    }
    if (arg === '--confirm-local-delete') {
      options.confirmLocalDelete = true
      continue
    }
    const value = args[index + 1]
    if (value == null) {
      throw new Error(`Missing value for ${arg}`)
    }
    if (arg === '--append-only-dir') {
      options.appendOnlyDir = value
    } else if (arg === '--manifest') {
      options.manifestPath = value
    } else if (arg === '--month') {
      options.month = value
    } else if (arg === '--output-dir') {
      options.outputDir = value
    } else if (arg === '--verified-manifest-sha256') {
      options.verifiedManifestSha256 = value
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
    index += 1
  }

  if (options.appendOnlyDir == null) {
    throw new Error(
      [
        'Usage:',
        '  Export: tsx src/db/sqlite/dump-cli.ts --append-only-dir <dir> --month <YYYY-MM> --output-dir <dir>',
        '  Cleanup: tsx src/db/sqlite/dump-cli.ts --append-only-dir <dir> --cleanup --manifest <path> --verified-manifest-sha256 <sha256> --confirm-local-delete',
      ].join('\n'),
    )
  }

  if (options.cleanup) {
    if (!options.confirmLocalDelete) {
      throw new Error('--cleanup requires --confirm-local-delete')
    }
    if (options.manifestPath == null || options.verifiedManifestSha256 == null) {
      throw new Error('--cleanup requires --manifest and --verified-manifest-sha256')
    }
  } else if (options.month == null || options.outputDir == null) {
    throw new Error('Export requires --month and --output-dir')
  }

  return options as DumpCliOptions
}

export const runAppendOnlyDumpCli = async (
  args = process.argv.slice(2),
): Promise<AppendOnlyDumpResult> => {
  const options = parseArgs(args)
  if (options.cleanup) {
    return removeManifestValidatedAppendOnlyMonth({
      appendOnlyDir: options.appendOnlyDir,
      manifestPath: options.manifestPath as string,
      verifiedManifestSha256: options.verifiedManifestSha256 as string,
    })
  }
  return exportAppendOnlyMonth({
    appendOnlyDir: options.appendOnlyDir,
    month: options.month as string,
    outputDir: options.outputDir as string,
  })
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
