import { type DumpRunRow } from '../db/postgres/dumps/dump-run-repository'
import { publishDumpMonth } from '../db/postgres/dumps/publish-dump-month'
import { parseDumpMonth } from '../db/postgres/partitions/dump-month'
import {
  collectDatabaseUrlSecret,
  collectR2Secrets,
  defaultDumpCommandDeps,
  requireExactlyOneArg,
  requirePostgresBackend,
  sanitizeCommandError,
  withOfflineDumpPool,
  type CliEnv,
  type DumpCommandDeps,
} from './dump-command-support'

/**
 * `npm run db:dumps:publish -- <YYYY-MM>` (scripts/postgres-dump-publish.ts). Kept as a plain
 * `run...Command(args, env, deps)` function — never touching `process.argv`/`process.env`
 * directly — so the full argument-validation/backend-check/R2-config/offline-pool sequencing is
 * unit-testable (tests/postgres-dump-publish-command.test.ts) without spawning the script as a
 * child process or connecting to a real database.
 */
export interface PublishDumpMonthCommandDeps extends DumpCommandDeps {
  readonly publishDumpMonth: typeof publishDumpMonth
}

export const defaultPublishDumpMonthCommandDeps: PublishDumpMonthCommandDeps = {
  ...defaultDumpCommandDeps,
  publishDumpMonth,
}

export const publishDumpMonthCommandUsage = 'db:dumps:publish -- <YYYY-MM>'

export const runPublishDumpMonthCommand = async (
  args: readonly string[],
  env: CliEnv,
  deps: PublishDumpMonthCommandDeps = defaultPublishDumpMonthCommandDeps,
): Promise<DumpRunRow> => {
  // Validate the one argument before touching env, R2, or the database at all.
  const dumpMonthArg = requireExactlyOneArg(args, publishDumpMonthCommandUsage)
  const parts = parseDumpMonth(dumpMonthArg)

  const secrets: string[] = []
  try {
    const databaseUrl = deps.resolveDatabaseUrl(env)
    collectDatabaseUrlSecret(databaseUrl, secrets)
    requirePostgresBackend(databaseUrl, deps, 'Community Dump publish')

    const r2Config = deps.loadR2Config(env)
    collectR2Secrets(r2Config, secrets)
    const objectStore = deps.createObjectStore(r2Config)

    return await withOfflineDumpPool(databaseUrl, deps, (dumpPool) =>
      deps.publishDumpMonth(dumpPool, objectStore, parts.text),
    )
  } catch (error) {
    throw sanitizeCommandError(error, secrets)
  }
}
