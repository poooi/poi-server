import { type Pool } from 'pg'

import { resolveDatabaseBackend, resolveDatabaseUrl, type DatabaseBackend } from '../db/backend'
import { createOfflineDumpPool } from '../db/postgres/client'
import { type DumpPool } from '../db/postgres/dumps/adapter'
import { createDumpPoolFromPgPool } from '../db/postgres/dumps/pg-query-stream-adapter'
import { type ObjectStore } from '../object-store/object-store'
import {
  createR2ObjectStore,
  loadR2ObjectStoreConfigFromEnv,
  type R2ObjectStoreConfig,
} from '../object-store/r2-object-store'

/**
 * Shared plumbing for the Community Dump publish, cleanup, and scheduled-maintenance CLI commands
 * (docs/postgresql-migration-plan.md lines 622-811). They validate argv first, require a PostgreSQL
 * backend, load `POI_SERVER_DUMP_R2_*` config, and wire an offline pg `Pool` through the `DumpPool`
 * adapter in that order, so malformed arguments or a non-Postgres backend never create database or
 * R2 clients. Each command module adds only its own workflow dependencies to `DumpCommandDeps`.
 *
 * Every dependency is injectable via `DumpCommandDeps` so command sequencing remains unit-testable
 * with plain fakes. The scripts themselves stay thin argv/env/exit-code wiring with no logic.
 */
export type CliEnv = Partial<Record<string, string>>

export interface DumpCommandDeps {
  readonly resolveDatabaseUrl: (env: CliEnv) => string
  readonly resolveDatabaseBackend: (databaseUrl: string) => DatabaseBackend
  readonly loadR2Config: (env: CliEnv) => R2ObjectStoreConfig
  readonly createObjectStore: (config: R2ObjectStoreConfig) => ObjectStore
  readonly createOfflineDumpPool: (databaseUrl: string) => Pool
  readonly createDumpPoolFromPgPool: (pool: Pool) => DumpPool
  /** Always invoked exactly once per command run, success or failure (see `withOfflineDumpPool`). */
  readonly endPool: (pool: Pool) => Promise<void>
}

export const defaultDumpCommandDeps: DumpCommandDeps = {
  resolveDatabaseUrl,
  resolveDatabaseBackend,
  loadR2Config: loadR2ObjectStoreConfigFromEnv,
  createObjectStore: createR2ObjectStore,
  createOfflineDumpPool,
  createDumpPoolFromPgPool,
  endPool: (pool) => pool.end(),
}

/** Rejects anything but exactly one non-empty positional argument, before any dependency runs. */
export const requireExactlyOneArg = (args: readonly string[], usage: string): string => {
  const [only, ...rest] = args
  if (only === undefined || only === '' || rest.length > 0) {
    throw new Error(`Usage: ${usage}`)
  }
  return only
}

export const requireNoArgs = (args: readonly string[], usage: string): void => {
  if (args.length > 0) {
    throw new Error(`Usage: ${usage}`)
  }
}

const extractDatabaseUrlPassword = (databaseUrl: string): string | null => {
  try {
    const url = new URL(databaseUrl)
    return url.password || null
  } catch {
    return null
  }
}

/** Records `databaseUrl`'s password (if any) as a secret to redact from later error messages. */
export const collectDatabaseUrlSecret = (databaseUrl: string, secrets: string[]): void => {
  const password = extractDatabaseUrlPassword(databaseUrl)
  if (password !== null) {
    secrets.push(password)
  }
}

/** Records both R2 credential values as secrets to redact from later error messages. */
export const collectR2Secrets = (config: R2ObjectStoreConfig, secrets: string[]): void => {
  secrets.push(config.accessKeyId, config.secretAccessKey)
}

export const redactSecretsInMessage = (message: string, secrets: readonly string[]): string =>
  secrets.reduce(
    (redacted, secret) =>
      secret.length === 0 ? redacted : redacted.split(secret).join('<redacted>'),
    message,
  )

/**
 * Converts any thrown value into a plain `Error` whose message has every known secret value
 * (collected so far by `collectDatabaseUrlSecret`/`collectR2Secrets`) redacted. Never reveals a
 * database URL's password or an R2 access key/secret, even if a lower layer's error message
 * happened to include one verbatim (docs/postgresql-migration-plan.md's operational requirement
 * that CLI tooling never leak credentials).
 */
export const sanitizeCommandError = (error: unknown, secrets: readonly string[]): Error => {
  const message = error instanceof Error ? error.message : String(error)
  return new Error(redactSecretsInMessage(message, secrets))
}

/** Throws an actionable error naming `commandLabel` unless `databaseUrl` is a PostgreSQL URL. */
export const requirePostgresBackend = (
  databaseUrl: string,
  deps: Pick<DumpCommandDeps, 'resolveDatabaseBackend'>,
  commandLabel: string,
): void => {
  if (deps.resolveDatabaseBackend(databaseUrl) !== 'postgresql') {
    throw new Error(
      `${commandLabel} requires a postgres: or postgresql: database URL (POI_SERVER_DATABASE_URL)`,
    )
  }
}

/**
 * Creates the offline dump pool, wraps it in the `DumpPool` adapter, runs `work`, and always ends
 * the pool afterward — whether `work` resolves or rejects — so no CLI invocation ever leaves a
 * dangling PostgreSQL connection open.
 */
export const withOfflineDumpPool = async <T>(
  databaseUrl: string,
  deps: Pick<DumpCommandDeps, 'createOfflineDumpPool' | 'createDumpPoolFromPgPool' | 'endPool'>,
  work: (dumpPool: DumpPool) => Promise<T>,
): Promise<T> => {
  const pool = deps.createOfflineDumpPool(databaseUrl)
  try {
    return await work(deps.createDumpPoolFromPgPool(pool))
  } finally {
    await deps.endPool(pool)
  }
}
