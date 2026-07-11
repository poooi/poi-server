import { CommunityDumpError } from '../../../dumps/community-dump-errors'
import {
  parseCommunityDumpManifestV1,
  communityDumpManifestSchemaVersion,
  type CommunityDumpManifestV1,
} from '../../../dumps/community-dump-manifest'
import {
  deriveCommunityDumpDataObjectKey,
  deriveCommunityDumpManifestObjectKey,
} from '../../../dumps/community-dump-object-keys'
import {
  communityDumpDatasetNames,
  getCommunityDumpDataset,
  isCommunityDumpDatasetName,
} from '../../../dumps/community-dump-registry'
import { encodeNonNegativeSafeInteger } from '../../../dumps/community-dump-values'
import { verifyStoredObjectMatches, type ObjectStore } from '../../../object-store/object-store'
import { verifyPostgresSchema, type PostgresQueryClient } from '../lifecycle'
import { type PartitionPool, type PartitionQueryClient } from '../partitions/adapter'
import {
  assertExactMonthlyPartitionBounds,
  inspectPartitionCatalog,
  type ExpectedMonthlyPartitionBounds,
} from '../partitions/catalog'
import {
  computeDumpMonthBoundsUtc,
  deriveMonthlyPartitionName,
  parseDumpMonth,
  type DumpMonthParts,
} from '../partitions/dump-month'
import { quoteIdentifier } from '../partitions/sql-safety'
import { runInPartitionTransaction } from '../partitions/transaction'
import {
  listDumpFilesByRunId,
  listDumpFilesByRunIdForUpdate,
  loadDatabaseNow,
  loadDumpRunById,
  loadDumpRunByIdForUpdate,
  markDumpRunCleaned,
  type DumpFileRow,
  type DumpRunRow,
} from './dump-run-repository'
import { CommunityDumpPreconditionError, CommunityDumpVerificationMismatchError } from './errors'

/**
 * Community Dump cleanup workflow (docs/postgresql-migration-plan.md lines 754-765): "The cleanup
 * command must require one exact `data_dump_runs.id`, verify that run's Dump Month, schema
 * version, manifest object key, manifest digest, and published/eligible state, and refuse
 * wildcard or broad-table cleanup." `runId` is deliberately typed `unknown` (not `number`), the
 * same convention `CommunityDumpManifestFileInput`'s fields already use, so this function itself
 * refuses a wildcard/table-name/malformed id rather than trusting a caller-side cast.
 *
 * Three phases, matching plan steps 8-10 exactly:
 *  1. A read-only verification pass (one plain connection): confirms the current schema, loads
 *     the exact run and its nine `data_dump_files` rows, checks status and
 *     manifest-metadata presence, checks the grace period against the database's own clock
 *     (never `Date.now()` — contrast with `publish-dump-month.ts`'s deliberate use of it), then
 *     re-reads and re-verifies the manifest object and every one of the nine data objects.
 *  2. If the run is already `cleaned`, step 1 stops there (after confirming the run's recorded
 *     metadata is coherent) and returns `already-cleaned` — no object-store reads, no DDL.
 *  3. The destructive phase (docs/postgresql-migration-plan.md line 759): one transaction,
 *     protected by a transaction-scoped advisory lock keyed to this run, re-loads the run and its
 *     files with `FOR UPDATE`, proves neither changed since phase 1, rechecks the grace period
 *     again, catalog-proves each of the nine recorded partitions against its allowlisted parent
 *     (the compile-time `communityDumpDatasets` registry, never a database-supplied string) and
 *     exact JST bounds, and only then detaches and drops all nine — in that order, so a catalog
 *     mismatch anywhere means zero DDL is ever issued, not merely a rollback of some.
 */

export type CleanupDumpRunAction = 'cleaned' | 'already-cleaned'

export interface CleanupDumpRunResult {
  readonly runId: number
  readonly action: CleanupDumpRunAction
  readonly partitionsDropped: readonly string[]
}

/**
 * `verifyPostgresSchema` (db/postgres/lifecycle.ts) declares its `PostgresQueryClient` port's
 * `rows` as a mutable `Array<...>`, while `PartitionQueryClient` (this workflow's own port)
 * declares `rows` as `ReadonlyArray<...>` — structurally incompatible by TypeScript's array
 * variance rules even though every real implementation already returns a genuine mutable array at
 * runtime. This adapter (identical to `publish-dump-month.ts`'s) copies the row array once purely
 * to satisfy the type checker; no semantics change.
 */
const toPostgresQueryClient = (client: PartitionQueryClient): PostgresQueryClient => ({
  query: async (text, values) => {
    const result = await client.query(text, values)
    return { rows: result.rows.map((row) => row) }
  },
})

/**
 * A `DumpRunRow` narrowed to prove every field a real published-then-eligible (or published-then-
 * cleaned) run must have is actually present. Reused for both the normal pre-cleanup path and the
 * already-cleaned coherence check, so "coherent" means exactly the same thing in both places.
 */
type CleanupReadyDumpRun = DumpRunRow & {
  readonly manifestObjectKey: string
  readonly manifestBytes: number
  readonly manifestSha256: string
  readonly publishedAt: Date
  readonly cleanupEligibleAt: Date
}

function assertDumpRunHasCleanupMetadata(
  run: DumpRunRow,
  runId: number,
): asserts run is CleanupReadyDumpRun {
  if (run.manifestObjectKey === null || run.manifestBytes === null || run.manifestSha256 === null) {
    throw new CommunityDumpPreconditionError(
      `cleanupDumpRun: run ${runId} is missing manifest object key/bytes/hash; nothing changed`,
    )
  }
  if (run.publishedAt === null) {
    throw new CommunityDumpPreconditionError(
      `cleanupDumpRun: run ${runId} is missing published_at; nothing changed`,
    )
  }
  if (run.cleanupEligibleAt === null) {
    throw new CommunityDumpPreconditionError(
      `cleanupDumpRun: run ${runId} is missing cleanup_eligible_at; nothing changed`,
    )
  }
  if (run.cleanupEligibleAt.getTime() !== run.publishedAt.getTime() + 7 * 24 * 60 * 60 * 1000) {
    throw new CommunityDumpVerificationMismatchError(
      `cleanupDumpRun: run ${runId}'s cleanup eligibility is not exactly seven days after publication`,
    )
  }
}

/**
 * Proves `files` is exactly the nine `data_dump_files` rows this run's manifest must reference:
 * no duplicate or unknown dataset, no missing dataset, every row already R2-verified, and every
 * row's `objectKey`/`partitionName` exactly matches what the registry deterministically derives
 * for this Dump Month. "Extra" rows are structurally impossible to slip past this: a tenth
 * row can only repeat a known dataset (caught as a duplicate) or use an unknown one (caught
 * below), since there are exactly nine known dataset names in total.
 */
const assertExactDumpFiles = (
  runId: number,
  parts: DumpMonthParts,
  files: readonly DumpFileRow[],
): void => {
  const byDataset = new Map<string, DumpFileRow>()
  for (const file of files) {
    if (!isCommunityDumpDatasetName(file.dataset)) {
      throw new CommunityDumpVerificationMismatchError(
        `cleanupDumpRun: run ${runId} has a data_dump_files row with unknown dataset "${file.dataset}"`,
      )
    }
    if (byDataset.has(file.dataset)) {
      throw new CommunityDumpVerificationMismatchError(
        `cleanupDumpRun: run ${runId} has duplicate data_dump_files rows for dataset "${file.dataset}"`,
      )
    }
    byDataset.set(file.dataset, file)
  }
  for (const dataset of communityDumpDatasetNames) {
    if (!byDataset.has(dataset)) {
      throw new CommunityDumpVerificationMismatchError(
        `cleanupDumpRun: run ${runId} is missing a data_dump_files row for dataset "${dataset}"`,
      )
    }
  }
  if (byDataset.size !== communityDumpDatasetNames.length) {
    throw new CommunityDumpVerificationMismatchError(
      `cleanupDumpRun: run ${runId} expected exactly ${communityDumpDatasetNames.length} data_dump_files row(s), found ${byDataset.size}`,
    )
  }

  for (const dataset of communityDumpDatasetNames) {
    const file = byDataset.get(dataset)
    /* c8 ignore next 3 -- the completeness check above guarantees every dataset is present */
    if (!file) {
      throw new CommunityDumpVerificationMismatchError(
        `cleanupDumpRun: run ${runId} is missing a data_dump_files row for dataset "${dataset}"`,
      )
    }
    if (file.verifiedAt === null) {
      throw new CommunityDumpVerificationMismatchError(
        `cleanupDumpRun: run ${runId}'s data_dump_files row for dataset "${dataset}" has never been verified`,
      )
    }
    const expectedObjectKey = deriveCommunityDumpDataObjectKey(parts.text, dataset)
    if (file.objectKey !== expectedObjectKey) {
      throw new CommunityDumpVerificationMismatchError(
        `cleanupDumpRun: run ${runId}'s data_dump_files row for dataset "${dataset}" has object key ` +
          `"${file.objectKey}", expected "${expectedObjectKey}"`,
      )
    }
    const definition = getCommunityDumpDataset(dataset)
    const expectedPartitionName = deriveMonthlyPartitionName(definition.table, parts)
    if (file.partitionName !== expectedPartitionName) {
      throw new CommunityDumpVerificationMismatchError(
        `cleanupDumpRun: run ${runId}'s data_dump_files row for dataset "${dataset}" has partition name ` +
          `"${file.partitionName}", expected "${expectedPartitionName}"`,
      )
    }
  }
}

/**
 * Proves the manifest re-read from the object store (already byte/hash-verified by
 * `verifyStoredObjectMatches` and structurally validated by `parseCommunityDumpManifestV1`)
 * actually describes this run: same Dump Month, same publication instant,
 * and every one of its nine file entries exactly matches the corresponding `data_dump_files` row
 * (`assertExactDumpFiles` already proved `files` has exactly one row per dataset).
 */
const assertManifestMatchesRun = (
  runId: number,
  manifest: CommunityDumpManifestV1,
  run: CleanupReadyDumpRun,
  files: readonly DumpFileRow[],
): void => {
  if (manifest.dumpMonth !== run.dumpMonth) {
    throw new CommunityDumpVerificationMismatchError(
      `cleanupDumpRun: run ${runId}'s manifest Dump Month "${manifest.dumpMonth}" does not match ` +
        `the run's "${run.dumpMonth}"`,
    )
  }
  if (manifest.publishedAt !== run.publishedAt.toISOString()) {
    throw new CommunityDumpVerificationMismatchError(
      `cleanupDumpRun: run ${runId}'s manifest publishedAt "${manifest.publishedAt}" does not match ` +
        `the run's "${run.publishedAt.toISOString()}"`,
    )
  }

  const filesByDataset = new Map(files.map((file) => [file.dataset, file]))
  for (const manifestFile of manifest.files) {
    const file = filesByDataset.get(manifestFile.dataset)
    /* c8 ignore next 5 -- assertExactDumpFiles already proved every manifest dataset is present */
    if (!file) {
      throw new CommunityDumpVerificationMismatchError(
        `cleanupDumpRun: run ${runId}'s manifest references dataset "${manifestFile.dataset}", which ` +
          'has no corresponding data_dump_files row',
      )
    }
    if (
      manifestFile.objectKey !== file.objectKey ||
      manifestFile.rowCount !== String(file.rowCount) ||
      manifestFile.compressedBytes !== String(file.compressedBytes) ||
      manifestFile.sha256 !== file.sha256
    ) {
      throw new CommunityDumpVerificationMismatchError(
        `cleanupDumpRun: run ${runId}'s manifest entry for dataset "${manifestFile.dataset}" does not ` +
          'exactly match its data_dump_files row',
      )
    }
  }
}

const dateTimeOrNull = (value: Date | null): number | null =>
  value === null ? null : value.getTime()

/** Proves the `FOR UPDATE` snapshot taken inside the destructive transaction is byte-for-byte
 * identical to the snapshot already verified in phase 1 — the concrete "prove no metadata/status
 * changed" re-proof the migration plan requires immediately before any DDL runs. */
const assertRunSnapshotUnchanged = (
  expected: DumpRunRow,
  actual: DumpRunRow,
  runId: number,
): void => {
  const changed =
    expected.dumpMonth !== actual.dumpMonth ||
    expected.schemaVersion !== actual.schemaVersion ||
    expected.status !== actual.status ||
    expected.manifestObjectKey !== actual.manifestObjectKey ||
    expected.manifestBytes !== actual.manifestBytes ||
    expected.manifestSha256 !== actual.manifestSha256 ||
    dateTimeOrNull(expected.publishedAt) !== dateTimeOrNull(actual.publishedAt) ||
    dateTimeOrNull(expected.cleanupEligibleAt) !== dateTimeOrNull(actual.cleanupEligibleAt) ||
    dateTimeOrNull(expected.cleanedAt) !== dateTimeOrNull(actual.cleanedAt) ||
    expected.error !== actual.error
  if (changed) {
    throw new CommunityDumpVerificationMismatchError(
      `cleanupDumpRun: run ${runId}'s data_dump_runs row changed between verification and the ` +
        'destructive transaction; refusing to proceed',
    )
  }
}

const assertFilesSnapshotUnchanged = (
  expected: readonly DumpFileRow[],
  actual: readonly DumpFileRow[],
  runId: number,
): void => {
  if (expected.length !== actual.length) {
    throw new CommunityDumpVerificationMismatchError(
      `cleanupDumpRun: run ${runId} had ${expected.length} data_dump_files row(s) during verification ` +
        `but ${actual.length} inside the destructive transaction`,
    )
  }
  const actualById = new Map(actual.map((file) => [file.id, file]))
  for (const file of expected) {
    const match = actualById.get(file.id)
    const changed =
      !match ||
      match.dumpRunId !== file.dumpRunId ||
      match.dataset !== file.dataset ||
      match.partitionName !== file.partitionName ||
      match.objectKey !== file.objectKey ||
      match.rowCount !== file.rowCount ||
      match.compressedBytes !== file.compressedBytes ||
      match.sha256 !== file.sha256 ||
      dateTimeOrNull(match.verifiedAt) !== dateTimeOrNull(file.verifiedAt)
    if (changed) {
      throw new CommunityDumpVerificationMismatchError(
        `cleanupDumpRun: run ${runId}'s data_dump_files row ${file.id} (dataset "${file.dataset}") ` +
          'changed between verification and the destructive transaction; refusing to proceed',
      )
    }
  }
}

export const cleanupDumpRun = async (
  pool: PartitionPool,
  objectStore: ObjectStore,
  runId: unknown,
): Promise<CleanupDumpRunResult> => {
  // Refuse a wildcard, table name, or any other non-exact id before ever connecting.
  const id = encodeNonNegativeSafeInteger(runId, 'cleanupDumpRun: runId')
  if (id === 0) {
    throw new CommunityDumpError('cleanupDumpRun: runId must be a positive integer')
  }

  const client = await pool.connect()
  let run: CleanupReadyDumpRun
  let files: readonly DumpFileRow[]
  let parts: DumpMonthParts
  try {
    await verifyPostgresSchema(toPostgresQueryClient(client))

    const loadedRun = await loadDumpRunById(client, id)
    if (!loadedRun) {
      throw new CommunityDumpPreconditionError(
        `cleanupDumpRun: no data_dump_runs row exists with id ${id}`,
      )
    }

    if (loadedRun.schemaVersion !== communityDumpManifestSchemaVersion) {
      throw new CommunityDumpPreconditionError(
        `cleanupDumpRun: run ${id} was recorded under schema version ${loadedRun.schemaVersion}, ` +
          `expected ${communityDumpManifestSchemaVersion}`,
      )
    }

    parts = parseDumpMonth(loadedRun.dumpMonth)
    const expectedManifestObjectKey = deriveCommunityDumpManifestObjectKey(parts.text)
    if (
      loadedRun.manifestObjectKey !== null &&
      loadedRun.manifestObjectKey !== expectedManifestObjectKey
    ) {
      throw new CommunityDumpVerificationMismatchError(
        `cleanupDumpRun: run ${id} has manifest object key "${loadedRun.manifestObjectKey}", ` +
          `expected "${expectedManifestObjectKey}"`,
      )
    }
    files = await listDumpFilesByRunId(client, id)

    if (loadedRun.status === 'cleaned') {
      assertDumpRunHasCleanupMetadata(loadedRun, id)
      assertExactDumpFiles(id, parts, files)
      return { runId: id, action: 'already-cleaned', partitionsDropped: [] }
    }

    if (loadedRun.status !== 'published' && loadedRun.status !== 'cleanup_eligible') {
      throw new CommunityDumpPreconditionError(
        `cleanupDumpRun: run ${id} has status "${loadedRun.status}", expected "published", ` +
          '"cleanup_eligible", or "cleaned"',
      )
    }
    assertDumpRunHasCleanupMetadata(loadedRun, id)
    run = loadedRun

    assertExactDumpFiles(id, parts, files)

    const now = await loadDatabaseNow(client)
    if (now.getTime() < run.cleanupEligibleAt.getTime()) {
      throw new CommunityDumpPreconditionError(
        `cleanupDumpRun: run ${id} is not eligible for cleanup until ` +
          `${run.cleanupEligibleAt.toISOString()} (database clock reports ${now.toISOString()})`,
      )
    }

    const manifestBytes = await verifyStoredObjectMatches(objectStore, run.manifestObjectKey, {
      bytes: run.manifestBytes,
      sha256Hex: run.manifestSha256,
    })
    const manifest = parseCommunityDumpManifestV1(manifestBytes)
    assertManifestMatchesRun(id, manifest, run, files)

    for (const file of files) {
      await verifyStoredObjectMatches(objectStore, file.objectKey, {
        bytes: file.compressedBytes,
        sha256Hex: file.sha256,
      })
    }
  } finally {
    client.release()
  }

  const lockKey = `poi-server:dump-cleanup:${id}`
  const partitionsDropped = await runInPartitionTransaction(pool, lockKey, async (txClient) => {
    const lockedRun = await loadDumpRunByIdForUpdate(txClient, id)
    if (!lockedRun) {
      throw new CommunityDumpVerificationMismatchError(
        `cleanupDumpRun: run ${id}'s data_dump_runs row disappeared before the destructive transaction`,
      )
    }
    assertRunSnapshotUnchanged(run, lockedRun, id)

    const lockedFiles = await listDumpFilesByRunIdForUpdate(txClient, id)
    assertFilesSnapshotUnchanged(files, lockedFiles, id)

    const now = await loadDatabaseNow(txClient)
    if (now.getTime() < run.cleanupEligibleAt.getTime()) {
      throw new CommunityDumpPreconditionError(
        `cleanupDumpRun: run ${id} is not eligible for cleanup until ` +
          `${run.cleanupEligibleAt.toISOString()} (database clock reports ${now.toISOString()})`,
      )
    }

    const lockedFilesByDataset = new Map(lockedFiles.map((file) => [file.dataset, file]))
    const bounds = computeDumpMonthBoundsUtc(parts)

    // Catalog-prove every one of the nine recorded partitions before issuing any DDL, so a
    // mismatch anywhere means zero detach/drop statements are ever sent.
    for (const dataset of communityDumpDatasetNames) {
      const definition = getCommunityDumpDataset(dataset)
      const file = lockedFilesByDataset.get(dataset)
      /* c8 ignore next 5 -- assertFilesSnapshotUnchanged already proved this set is exactly the nine known datasets */
      if (!file) {
        throw new CommunityDumpVerificationMismatchError(
          `cleanupDumpRun: run ${id} is missing a data_dump_files row for dataset "${dataset}"`,
        )
      }
      const expected: ExpectedMonthlyPartitionBounds = { parentTable: definition.table, ...bounds }
      const info = await inspectPartitionCatalog(txClient, file.partitionName)
      assertExactMonthlyPartitionBounds(file.partitionName, info, expected)
    }

    const droppedPartitionNames: string[] = []
    for (const dataset of communityDumpDatasetNames) {
      const definition = getCommunityDumpDataset(dataset)
      const file = lockedFilesByDataset.get(dataset)
      /* c8 ignore next 3 -- already proven present by the catalog-proof loop above */
      if (!file) {
        throw new CommunityDumpVerificationMismatchError(
          `cleanupDumpRun: run ${id} is missing a data_dump_files row for dataset "${dataset}"`,
        )
      }
      await txClient.query(
        `alter table ${quoteIdentifier(definition.table)} detach partition ${quoteIdentifier(file.partitionName)}`,
      )
      await txClient.query(`drop table ${quoteIdentifier(file.partitionName)}`)
      droppedPartitionNames.push(file.partitionName)
    }

    await markDumpRunCleaned(txClient, id)

    return droppedPartitionNames
  })

  return { runId: id, action: 'cleaned', partitionsDropped }
}
