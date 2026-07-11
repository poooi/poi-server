import { cleanupDumpRun, type CleanupDumpRunResult } from '../db/postgres/dumps/cleanup-dump-run'
import { encodeNonNegativeSafeInteger } from '../dumps/community-dump-values'
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
 * `npm run db:dumps:cleanup -- <data_dump_runs.id>` (scripts/postgres-dump-cleanup.ts). Kept as a
 * plain `run...Command(args, env, deps)` function for the same reason as
 * `runPublishDumpMonthCommand` (postgres-dump-publish-command.ts) — fully unit-testable
 * (tests/postgres-dump-cleanup-command.test.ts) without a child process or a real database.
 */
export interface CleanupDumpRunCommandDeps extends DumpCommandDeps {
  readonly cleanupDumpRun: typeof cleanupDumpRun
}

export const defaultCleanupDumpRunCommandDeps: CleanupDumpRunCommandDeps = {
  ...defaultDumpCommandDeps,
  cleanupDumpRun,
}

export const cleanupDumpRunCommandUsage = 'db:dumps:cleanup -- <data_dump_runs.id>'

/**
 * Deliberately stricter than `encodeNonNegativeSafeInteger` alone: the migration plan requires
 * "one exact `data_dump_runs.id`" (docs/postgresql-migration-plan.md lines 754-765), so this
 * rejects zero, negative numbers, decimals, exponents, leading zeros, and surrounding whitespace
 * — anything that is not exactly the canonical decimal text of a positive integer — before ever
 * calling `encodeNonNegativeSafeInteger` for the `Number.MAX_SAFE_INTEGER` bound check.
 */
const runIdArgPattern = /^[1-9][0-9]*$/

export const parseCleanupRunIdArg = (value: string): number => {
  if (!runIdArgPattern.test(value)) {
    throw new Error(`Run id must be a positive integer, got "${value}"`)
  }
  return encodeNonNegativeSafeInteger(value, 'runId')
}

export const runCleanupDumpRunCommand = async (
  args: readonly string[],
  env: CliEnv,
  deps: CleanupDumpRunCommandDeps = defaultCleanupDumpRunCommandDeps,
): Promise<CleanupDumpRunResult> => {
  // Validate the one argument before touching env, R2, or the database at all.
  const runIdArg = requireExactlyOneArg(args, cleanupDumpRunCommandUsage)
  const runId = parseCleanupRunIdArg(runIdArg)

  const secrets: string[] = []
  try {
    const databaseUrl = deps.resolveDatabaseUrl(env)
    collectDatabaseUrlSecret(databaseUrl, secrets)
    requirePostgresBackend(databaseUrl, deps, 'Community Dump cleanup')

    const r2Config = deps.loadR2Config(env)
    collectR2Secrets(r2Config, secrets)
    const objectStore = deps.createObjectStore(r2Config)

    return await withOfflineDumpPool(databaseUrl, deps, (dumpPool) =>
      deps.cleanupDumpRun(dumpPool, objectStore, runId),
    )
  } catch (error) {
    throw sanitizeCommandError(error, secrets)
  }
}
