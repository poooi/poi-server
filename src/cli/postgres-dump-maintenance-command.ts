import { cleanupDumpRun, type CleanupDumpRunResult } from '../db/postgres/dumps/cleanup-dump-run'
import {
  listCleanupEligibleDumpRuns,
  type DumpRunRow,
} from '../db/postgres/dumps/dump-run-repository'
import { publishDumpMonth } from '../db/postgres/dumps/publish-dump-month'
import {
  createUpcomingMonthPartitions,
  type CreateUpcomingMonthPartitionOutcome,
} from '../db/postgres/partitions/create-upcoming-month'
import { deriveAdjacentJstDumpMonths } from '../db/postgres/partitions/dump-month'
import {
  collectDatabaseUrlSecret,
  collectR2Secrets,
  defaultDumpCommandDeps,
  requireNoArgs,
  requirePostgresBackend,
  sanitizeCommandError,
  type CliEnv,
  type DumpCommandDeps,
} from './dump-command-support'

export interface DumpMaintenanceCommandDeps extends DumpCommandDeps {
  readonly now: () => Date
  readonly createUpcomingMonthPartitions: typeof createUpcomingMonthPartitions
  readonly publishDumpMonth: typeof publishDumpMonth
  readonly listCleanupEligibleDumpRuns: typeof listCleanupEligibleDumpRuns
  readonly cleanupDumpRun: typeof cleanupDumpRun
}

export interface DumpMaintenanceResult {
  readonly previousDumpMonth: string
  readonly upcomingDumpMonth: string
  readonly partitions: readonly CreateUpcomingMonthPartitionOutcome[]
  readonly publishedRun: DumpRunRow
  readonly cleanups: readonly CleanupDumpRunResult[]
}

export const defaultDumpMaintenanceCommandDeps: DumpMaintenanceCommandDeps = {
  ...defaultDumpCommandDeps,
  now: () => new Date(),
  createUpcomingMonthPartitions,
  publishDumpMonth,
  listCleanupEligibleDumpRuns,
  cleanupDumpRun,
}

export const dumpMaintenanceCommandUsage = 'db:dumps:maintain'

export const runDumpMaintenanceCommand = async (
  args: readonly string[],
  env: CliEnv,
  deps: DumpMaintenanceCommandDeps = defaultDumpMaintenanceCommandDeps,
): Promise<DumpMaintenanceResult> => {
  requireNoArgs(args, dumpMaintenanceCommandUsage)
  const { previous, next } = deriveAdjacentJstDumpMonths(deps.now())

  const secrets: string[] = []
  try {
    const databaseUrl = deps.resolveDatabaseUrl(env)
    collectDatabaseUrlSecret(databaseUrl, secrets)
    requirePostgresBackend(databaseUrl, deps, 'Community Dump maintenance')

    const r2Config = deps.loadR2Config(env)
    collectR2Secrets(r2Config, secrets)
    const objectStore = deps.createObjectStore(r2Config)

    const pool = deps.createOfflineDumpPool(databaseUrl)
    try {
      const dumpPool = deps.createDumpPoolFromPgPool(pool)

      const failures: string[] = []
      let partitions: readonly CreateUpcomingMonthPartitionOutcome[] | undefined
      let publishedRun: DumpRunRow | undefined
      const cleanups: CleanupDumpRunResult[] = []

      try {
        partitions = await deps.createUpcomingMonthPartitions(pool, next)
      } catch (error) {
        failures.push(
          `create upcoming partitions for ${next}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }

      try {
        publishedRun = await deps.publishDumpMonth(dumpPool, objectStore, previous)
      } catch (error) {
        failures.push(
          `publish Dump Month ${previous}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }

      let eligibleRuns: readonly DumpRunRow[] = []
      try {
        const client = await dumpPool.connect()
        try {
          eligibleRuns = await deps.listCleanupEligibleDumpRuns(client)
        } finally {
          client.release()
        }
      } catch (error) {
        failures.push(
          `discover cleanup-eligible runs: ${error instanceof Error ? error.message : String(error)}`,
        )
      }

      for (const run of eligibleRuns) {
        try {
          cleanups.push(await deps.cleanupDumpRun(dumpPool, objectStore, run.id))
        } catch (error) {
          failures.push(
            `clean dump run ${run.id}: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }

      if (failures.length > 0) {
        throw new Error(
          `Community Dump maintenance completed with ${failures.length} failure(s):\n${failures.join('\n')}`,
        )
      }
      if (partitions === undefined || publishedRun === undefined) {
        throw new Error('Community Dump maintenance completed without required phase results')
      }

      return {
        previousDumpMonth: previous,
        upcomingDumpMonth: next,
        partitions,
        publishedRun,
        cleanups,
      }
    } finally {
      await deps.endPool(pool)
    }
  } catch (error) {
    throw sanitizeCommandError(error, secrets)
  }
}
