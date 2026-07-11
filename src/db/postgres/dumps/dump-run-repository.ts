import { type PartitionQueryClient } from '../partitions/adapter'
import { type DumpMonthParts } from '../partitions/dump-month'
import { encodeNonNegativeSafeInteger } from '../../../dumps/community-dump-values'
import { CommunityDumpVerificationMismatchError, CommunityDumpWorkflowError } from './errors'

/**
 * `data_dump_runs`/`data_dump_files` repository (docs/postgresql-migration-plan.md lines 736-739,
 * 746-752, 761-764). Every function here takes a plain `PartitionQueryClient` — the exact same
 * structural port `db/postgres/partitions/catalog.ts` uses — so it can run inside either a plain
 * pool connection or any transaction helper, and unit tests supply a fake client with no
 * database. BIGINT columns (`id`, `dump_run_id`, `manifest_bytes`, `row_count`,
 * `compressed_bytes`) come back from node-postgres as decimal strings (no custom type parser is
 * registered anywhere in this codebase — see `v3.postgres.actions.ts`'s identical note), so every
 * numeric field is converted with `encodeNonNegativeSafeInteger` (reused from
 * `dumps/community-dump-values.ts`, the same non-negative-safe-integer invariant the Community
 * Dump serializer itself relies on) rather than trusted as a native `number`.
 *
 * `dump_month` is read back via `to_char(dump_month, 'YYYY-MM')` rather than as a native `date`
 * value: node-postgres's default `date` parser builds a `Date` from local calendar components,
 * which would silently shift by one calendar day whenever this process's local timezone differs
 * from UTC. Casting to text in SQL sidesteps that entirely.
 */

export type DumpRunStatus =
  'pending' | 'exporting' | 'uploaded' | 'published' | 'cleanup_eligible' | 'cleaned' | 'failed'

export interface DumpRunRow {
  readonly id: number
  readonly dumpMonth: string
  readonly schemaVersion: number
  readonly status: DumpRunStatus
  readonly manifestObjectKey: string | null
  readonly manifestBytes: number | null
  readonly manifestSha256: string | null
  readonly publishedAt: Date | null
  readonly cleanupEligibleAt: Date | null
  readonly cleanedAt: Date | null
  readonly error: string | null
}

export interface DumpFileRow {
  readonly id: number
  readonly dumpRunId: number
  readonly dataset: string
  readonly partitionName: string
  readonly objectKey: string
  readonly rowCount: number
  readonly compressedBytes: number
  readonly sha256: string
  readonly verifiedAt: Date | null
}

const dumpRunColumns = `
  id,
  to_char(dump_month, 'YYYY-MM') as dump_month,
  schema_version,
  status,
  manifest_object_key,
  manifest_bytes,
  manifest_sha256,
  published_at,
  cleanup_eligible_at,
  cleaned_at,
  error
`.trim()

const dumpFileColumns = `
  id,
  dump_run_id,
  dataset,
  partition_name,
  object_key,
  row_count,
  compressed_bytes,
  sha256,
  verified_at
`.trim()

const sha256BufferFromHex = (hex: string): Buffer => Buffer.from(hex, 'hex')

const sha256HexFromBuffer = (value: unknown, fieldName: string): string => {
  if (!Buffer.isBuffer(value)) {
    throw new CommunityDumpWorkflowError(
      `${fieldName}: expected a bytea Buffer, got ${typeof value}`,
    )
  }
  return value.toString('hex')
}

const asDateOrNull = (value: unknown, fieldName: string): Date | null => {
  if (value === null || value === undefined) {
    return null
  }
  if (!(value instanceof Date)) {
    throw new CommunityDumpWorkflowError(
      `${fieldName}: expected a Date or null, got ${typeof value}`,
    )
  }
  return value
}

const asStringOrNull = (value: unknown, fieldName: string): string | null => {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value !== 'string') {
    throw new CommunityDumpWorkflowError(
      `${fieldName}: expected a string or null, got ${typeof value}`,
    )
  }
  return value
}

const asDumpRunStatus = (value: unknown): DumpRunStatus => {
  if (
    value === 'pending' ||
    value === 'exporting' ||
    value === 'uploaded' ||
    value === 'published' ||
    value === 'cleanup_eligible' ||
    value === 'cleaned' ||
    value === 'failed'
  ) {
    return value
  }
  throw new CommunityDumpWorkflowError(
    `data_dump_runs.status: unexpected value ${JSON.stringify(value)}`,
  )
}

const mapDumpRunRow = (row: Record<string, unknown>): DumpRunRow => {
  if (typeof row.dump_month !== 'string') {
    throw new CommunityDumpWorkflowError('data_dump_runs.dump_month: expected a string')
  }
  return {
    id: encodeNonNegativeSafeInteger(row.id, 'data_dump_runs.id'),
    dumpMonth: row.dump_month,
    schemaVersion: encodeNonNegativeSafeInteger(
      row.schema_version,
      'data_dump_runs.schema_version',
    ),
    status: asDumpRunStatus(row.status),
    manifestObjectKey: asStringOrNull(
      row.manifest_object_key,
      'data_dump_runs.manifest_object_key',
    ),
    manifestBytes:
      row.manifest_bytes === null || row.manifest_bytes === undefined
        ? null
        : encodeNonNegativeSafeInteger(row.manifest_bytes, 'data_dump_runs.manifest_bytes'),
    manifestSha256:
      row.manifest_sha256 === null || row.manifest_sha256 === undefined
        ? null
        : sha256HexFromBuffer(row.manifest_sha256, 'data_dump_runs.manifest_sha256'),
    publishedAt: asDateOrNull(row.published_at, 'data_dump_runs.published_at'),
    cleanupEligibleAt: asDateOrNull(row.cleanup_eligible_at, 'data_dump_runs.cleanup_eligible_at'),
    cleanedAt: asDateOrNull(row.cleaned_at, 'data_dump_runs.cleaned_at'),
    error: asStringOrNull(row.error, 'data_dump_runs.error'),
  }
}

const asStringNotNull = (value: unknown, fieldName: string): string => {
  if (typeof value !== 'string') {
    throw new CommunityDumpWorkflowError(`${fieldName}: expected a string, got ${typeof value}`)
  }
  return value
}

const mapDumpFileRow = (row: Record<string, unknown>): DumpFileRow => ({
  id: encodeNonNegativeSafeInteger(row.id, 'data_dump_files.id'),
  dumpRunId: encodeNonNegativeSafeInteger(row.dump_run_id, 'data_dump_files.dump_run_id'),
  dataset: asStringNotNull(row.dataset, 'data_dump_files.dataset'),
  partitionName: asStringNotNull(row.partition_name, 'data_dump_files.partition_name'),
  objectKey: asStringNotNull(row.object_key, 'data_dump_files.object_key'),
  rowCount: encodeNonNegativeSafeInteger(row.row_count, 'data_dump_files.row_count'),
  compressedBytes: encodeNonNegativeSafeInteger(
    row.compressed_bytes,
    'data_dump_files.compressed_bytes',
  ),
  sha256: sha256HexFromBuffer(row.sha256, 'data_dump_files.sha256'),
  verifiedAt: asDateOrNull(row.verified_at, 'data_dump_files.verified_at'),
})

const singleRowOrThrow = (
  rows: ReadonlyArray<Record<string, unknown>>,
  notFoundMessage: string,
): Record<string, unknown> => {
  const [row] = rows
  if (!row) {
    throw new CommunityDumpWorkflowError(notFoundMessage)
  }
  return row
}

export interface FindOrCreateDumpRunInput {
  readonly dumpMonth: DumpMonthParts
  readonly schemaVersion: number
}

const dumpMonthDateLiteral = (parts: DumpMonthParts): string =>
  `${parts.year.toString().padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-01`

/**
 * Finds or creates the one canonical `data_dump_runs` row for a Dump Month. A fresh row starts at
 * `status = 'pending'`; resuming an existing row leaves every already-persisted column untouched
 * (only `updated_at` moves), so a retry continues from wherever the previous attempt left off
 * instead of losing its progress. A different schema version for an already-reserved month is
 * rejected: object keys are immutable and intentionally identify one canonical publication per
 * Dump Month, while the manifest records which schema that publication uses.
 */
export const findOrCreateDumpRun = async (
  client: PartitionQueryClient,
  input: FindOrCreateDumpRunInput,
): Promise<DumpRunRow> => {
  const dumpMonthLiteral = dumpMonthDateLiteral(input.dumpMonth)
  const result = await client.query(
    `
insert into data_dump_runs (dump_month, schema_version, status)
values ($1, $2, 'pending')
on conflict (dump_month)
do update set updated_at = clock_timestamp()
where data_dump_runs.schema_version = excluded.schema_version
returning ${dumpRunColumns}
`.trim(),
    [dumpMonthLiteral, input.schemaVersion],
  )

  const [runRow] = result.rows
  if (!runRow) {
    const existingResult = await client.query(
      `select schema_version from data_dump_runs where dump_month = $1`,
      [dumpMonthLiteral],
    )
    const existingRow = singleRowOrThrow(
      existingResult.rows,
      'findOrCreateDumpRun: conflicting Dump Month row disappeared',
    )
    const existingSchemaVersion = encodeNonNegativeSafeInteger(
      existingRow.schema_version,
      'data_dump_runs.schema_version',
    )
    throw new CommunityDumpWorkflowError(
      `Dump Month ${input.dumpMonth.text} is already reserved with schema version ${existingSchemaVersion}; ` +
        `refusing requested schema version ${input.schemaVersion}`,
    )
  }
  return mapDumpRunRow(runRow)
}

/** Loads one `data_dump_runs` row by its exact id, or `null` if it does not exist. */
export const loadDumpRunById = async (
  client: PartitionQueryClient,
  runId: number,
): Promise<DumpRunRow | null> => {
  const result = await client.query(`select ${dumpRunColumns} from data_dump_runs where id = $1`, [
    runId,
  ])
  const [row] = result.rows
  return row ? mapDumpRunRow(row) : null
}

/**
 * Lists only runs whose database-clock grace period has elapsed. The maintenance command still
 * sends each exact id through cleanupDumpRun, which re-verifies eligibility and all destructive
 * preconditions under its own locks before dropping anything.
 */
export const listCleanupEligibleDumpRuns = async (
  client: PartitionQueryClient,
): Promise<readonly DumpRunRow[]> => {
  const result = await client.query(
    `
select ${dumpRunColumns}
from data_dump_runs
where status in ('published', 'cleanup_eligible')
  and cleanup_eligible_at <= clock_timestamp()
order by cleanup_eligible_at, id
`.trim(),
  )
  return result.rows.map(mapDumpRunRow)
}

/**
 * Identical to {@link loadDumpRunById}, except it takes a `for update` row lock. Reserved for the
 * cleanup workflow's final destructive transaction (docs/postgresql-migration-plan.md lines
 * 759, 762-764), immediately before it re-proves the run's metadata/status has not changed since
 * the workflow's earlier (unlocked) verification pass and before it commits `markDumpRunCleaned`,
 * so a concurrent writer can never race the destructive transaction between those two points.
 */
export const loadDumpRunByIdForUpdate = async (
  client: PartitionQueryClient,
  runId: number,
): Promise<DumpRunRow | null> => {
  const result = await client.query(
    `select ${dumpRunColumns} from data_dump_runs where id = $1 for update`,
    [runId],
  )
  const [row] = result.rows
  return row ? mapDumpRunRow(row) : null
}

/**
 * Updates `status` and `error` together — every transition sets both explicitly so a stale
 * failure message can never survive past the point where the run has moved on (plan line 736:
 * "actionable status/error transitions").
 */
export const setDumpRunStatus = async (
  client: PartitionQueryClient,
  runId: number,
  status: DumpRunStatus,
  error: string | null,
): Promise<DumpRunRow> => {
  const result = await client.query(
    `
update data_dump_runs
set status = $2, error = $3, updated_at = clock_timestamp()
where id = $1
returning ${dumpRunColumns}
`.trim(),
    [runId, status, error],
  )
  return mapDumpRunRow(
    singleRowOrThrow(result.rows, `setDumpRunStatus: no data_dump_runs row with id ${runId}`),
  )
}

/**
 * Persists (or, on retry, re-reads) a stable `published_at` instant for this run, chosen exactly
 * once via `coalesce`, so a manifest built on retry after an interruption serializes the exact
 * same `publishedAt` field and is therefore byte-identical to the one already uploaded (plan
 * lines 750-752, 762: "must never overwrite a committed manifest").
 */
export const reservePublicationTimestamp = async (
  client: PartitionQueryClient,
  runId: number,
): Promise<Date> => {
  const result = await client.query(
    `
update data_dump_runs
set published_at = coalesce(published_at, clock_timestamp()), updated_at = clock_timestamp()
where id = $1
returning published_at
`.trim(),
    [runId],
  )
  const row = singleRowOrThrow(
    result.rows,
    `reservePublicationTimestamp: no data_dump_runs row with id ${runId}`,
  )
  const publishedAt = asDateOrNull(row.published_at, 'data_dump_runs.published_at')
  if (publishedAt === null) {
    /* c8 ignore next 3 -- coalesce(published_at, clock_timestamp()) can never leave this null */
    throw new CommunityDumpWorkflowError(
      'reservePublicationTimestamp: published_at was unexpectedly null',
    )
  }
  return publishedAt
}

export interface RecordManifestMetadataInput {
  readonly objectKey: string
  readonly bytes: number
  readonly sha256Hex: string
}

/** Persists the manifest's object key, byte count, and SHA-256 once they are known (plan line 750). */
export const recordManifestMetadata = async (
  client: PartitionQueryClient,
  runId: number,
  input: RecordManifestMetadataInput,
): Promise<DumpRunRow> => {
  const result = await client.query(
    `
update data_dump_runs
set manifest_object_key = $2, manifest_bytes = $3, manifest_sha256 = $4, status = 'uploaded', error = null, updated_at = clock_timestamp()
where id = $1
returning ${dumpRunColumns}
`.trim(),
    [runId, input.objectKey, input.bytes, sha256BufferFromHex(input.sha256Hex)],
  )
  return mapDumpRunRow(
    singleRowOrThrow(result.rows, `recordManifestMetadata: no data_dump_runs row with id ${runId}`),
  )
}

/**
 * Marks the run published and derives `cleanup_eligible_at` from the already-persisted
 * `published_at` entirely in SQL, so it always satisfies the
 * `data_dump_runs_cleanup_eligible_at_offset` check constraint exactly (plan line 753: "start a
 * seven-day cleanup grace period"). This is the publish workflow's commit point.
 */
export const markDumpRunPublished = async (
  client: PartitionQueryClient,
  runId: number,
): Promise<DumpRunRow> => {
  const result = await client.query(
    `
update data_dump_runs
set status = 'published', cleanup_eligible_at = published_at + interval '168 hours', error = null, updated_at = clock_timestamp()
where id = $1
returning ${dumpRunColumns}
`.trim(),
    [runId],
  )
  return mapDumpRunRow(
    singleRowOrThrow(result.rows, `markDumpRunPublished: no data_dump_runs row with id ${runId}`),
  )
}

/** Marks the run cleaned once its nine partitions have been detached/dropped (plan line 759). */
export const markDumpRunCleaned = async (
  client: PartitionQueryClient,
  runId: number,
): Promise<DumpRunRow> => {
  const result = await client.query(
    `
update data_dump_runs
set status = 'cleaned', cleaned_at = clock_timestamp(), error = null, updated_at = clock_timestamp()
where id = $1
returning ${dumpRunColumns}
`.trim(),
    [runId],
  )
  return mapDumpRunRow(
    singleRowOrThrow(result.rows, `markDumpRunCleaned: no data_dump_runs row with id ${runId}`),
  )
}

export interface RecordDumpFileExportInput {
  readonly dumpRunId: number
  readonly dataset: string
  readonly partitionName: string
  readonly objectKey: string
  readonly rowCount: number
  readonly compressedBytes: number
  readonly sha256Hex: string
}

const fileExportMatchesInput = (existing: DumpFileRow, input: RecordDumpFileExportInput): boolean =>
  existing.partitionName === input.partitionName &&
  existing.objectKey === input.objectKey &&
  existing.rowCount === input.rowCount &&
  existing.compressedBytes === input.compressedBytes &&
  existing.sha256.toLowerCase() === input.sha256Hex.toLowerCase()

/**
 * Upserts one of the nine `data_dump_files` rows for a run. If a row already exists for this
 * `(dumpRunId, dataset)` and has already been R2-verified (`verifiedAt` set), it is treated as
 * committed: this function refuses to silently change it, requiring the freshly recomputed
 * export metadata to match exactly, or throwing `CommunityDumpVerificationMismatchError`
 * otherwise. A not-yet-verified existing row (a previous attempt that crashed before upload) is
 * simply overwritten, since re-exporting the same closed partition is deterministic.
 */
export const recordDumpFileExport = async (
  client: PartitionQueryClient,
  input: RecordDumpFileExportInput,
): Promise<DumpFileRow> => {
  const existingResult = await client.query(
    `select ${dumpFileColumns} from data_dump_files where dump_run_id = $1 and dataset = $2`,
    [input.dumpRunId, input.dataset],
  )
  const [existingRawRow] = existingResult.rows
  if (existingRawRow) {
    const existing = mapDumpFileRow(existingRawRow)
    if (existing.verifiedAt !== null) {
      if (!fileExportMatchesInput(existing, input)) {
        throw new CommunityDumpVerificationMismatchError(
          `data_dump_files row for run ${input.dumpRunId}, dataset "${input.dataset}" is already verified ` +
            `but does not match the freshly recomputed export (existing: partition "${existing.partitionName}", ` +
            `${existing.rowCount} row(s), ${existing.compressedBytes} byte(s), sha256 ${existing.sha256}; ` +
            `recomputed: partition "${input.partitionName}", ${input.rowCount} row(s), ${input.compressedBytes} ` +
            `byte(s), sha256 ${input.sha256Hex})`,
        )
      }
      return existing
    }
  }

  const result = await client.query(
    `
insert into data_dump_files (dump_run_id, dataset, partition_name, object_key, row_count, compressed_bytes, sha256)
values ($1, $2, $3, $4, $5, $6, $7)
on conflict (dump_run_id, dataset)
do update set
  partition_name = excluded.partition_name,
  object_key = excluded.object_key,
  row_count = excluded.row_count,
  compressed_bytes = excluded.compressed_bytes,
  sha256 = excluded.sha256
returning ${dumpFileColumns}
`.trim(),
    [
      input.dumpRunId,
      input.dataset,
      input.partitionName,
      input.objectKey,
      input.rowCount,
      input.compressedBytes,
      sha256BufferFromHex(input.sha256Hex),
    ],
  )
  return mapDumpFileRow(
    singleRowOrThrow(result.rows, 'recordDumpFileExport: insert...on conflict returned no row'),
  )
}

/** Marks one `data_dump_files` row as R2-verified (plan line 748-749). */
export const markDumpFileVerified = async (
  client: PartitionQueryClient,
  dumpRunId: number,
  dataset: string,
): Promise<DumpFileRow> => {
  const result = await client.query(
    `
update data_dump_files
set verified_at = clock_timestamp()
where dump_run_id = $1 and dataset = $2
returning ${dumpFileColumns}
`.trim(),
    [dumpRunId, dataset],
  )
  return mapDumpFileRow(
    singleRowOrThrow(
      result.rows,
      `markDumpFileVerified: no data_dump_files row for run ${dumpRunId}, dataset "${dataset}"`,
    ),
  )
}

/** Lists every `data_dump_files` row recorded for a run (for cleanup's cross-check). */
export const listDumpFilesByRunId = async (
  client: PartitionQueryClient,
  dumpRunId: number,
): Promise<readonly DumpFileRow[]> => {
  const result = await client.query(
    `select ${dumpFileColumns} from data_dump_files where dump_run_id = $1 order by dataset`,
    [dumpRunId],
  )
  return result.rows.map(mapDumpFileRow)
}

/**
 * Identical to {@link listDumpFilesByRunId}, except it takes a `for update` row lock on every one
 * of the run's `data_dump_files` rows. Reserved for the cleanup workflow's final destructive
 * transaction (docs/postgresql-migration-plan.md lines 759, 762-764), for the same reason as
 * {@link loadDumpRunByIdForUpdate}: none of the nine rows this transaction is about to detach and
 * drop partitions for may change out from under it after it re-proves their metadata.
 */
export const listDumpFilesByRunIdForUpdate = async (
  client: PartitionQueryClient,
  dumpRunId: number,
): Promise<readonly DumpFileRow[]> => {
  const result = await client.query(
    `select ${dumpFileColumns} from data_dump_files where dump_run_id = $1 order by dataset for update`,
    [dumpRunId],
  )
  return result.rows.map(mapDumpFileRow)
}

/**
 * Reads the database server's own clock, never this process's `Date.now()`. The cleanup
 * workflow's grace-period eligibility check must be immune to wall-clock skew between the caller
 * and the database (docs/postgresql-migration-plan.md line 754: "After the grace period...");
 * contrast with `publish-dump-month.ts`, which deliberately uses `Date.now()` for its Dump Month
 * closed-check because that check has no such requirement.
 */
export const loadDatabaseNow = async (client: PartitionQueryClient): Promise<Date> => {
  const result = await client.query('select clock_timestamp() as now')
  const row = singleRowOrThrow(result.rows, 'loadDatabaseNow: clock_timestamp() returned no row')
  const now = asDateOrNull(row.now, 'clock_timestamp()')
  if (now === null) {
    /* c8 ignore next 3 -- clock_timestamp() never returns null */
    throw new CommunityDumpWorkflowError('loadDatabaseNow: clock_timestamp() returned null')
  }
  return now
}
