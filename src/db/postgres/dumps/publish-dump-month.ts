import { createHash } from 'crypto'

import {
  type CommunityDumpManifestFileInput,
  communityDumpManifestSchemaVersion,
  serializeCommunityDumpManifestV1,
} from '../../../dumps/community-dump-manifest'
import {
  deriveCommunityDumpDataObjectKey,
  deriveCommunityDumpManifestObjectKey,
} from '../../../dumps/community-dump-object-keys'
import { putImmutableAndVerify, type ObjectStore } from '../../../object-store/object-store'
import { verifyPostgresSchema, type PostgresQueryClient } from '../lifecycle'
import { type PartitionQueryClient } from '../partitions/adapter'
import {
  computeDumpMonthBoundsUtc,
  parseDumpMonth,
  type DumpMonthBoundsUtc,
} from '../partitions/dump-month'
import { type DumpPool } from './adapter'
import {
  findOrCreateDumpRun,
  markDumpFileVerified,
  markDumpRunPublished,
  recordDumpFileExport,
  recordManifestMetadata,
  reservePublicationTimestamp,
  setDumpRunStatus,
  type DumpRunRow,
} from './dump-run-repository'
import { CommunityDumpPreconditionError } from './errors'
import { exportDumpMonthPartitions } from './export-partitions'

/**
 * Community Dump publish workflow orchestrator (docs/postgresql-migration-plan.md lines
 * 740-753, 761-762). Idempotent and resumable: a fresh run walks the full pipeline once; a run
 * already `published` (or later) short-circuits without touching the export/upload path again;
 * a run left `pending`/`exporting`/`uploaded`/`failed` by a previous interrupted attempt walks
 * the full pipeline again, relying on `recordDumpFileExport`'s already-verified guard and
 * `putImmutableAndVerify`'s create-only-and-verify semantics to make every step safe to repeat
 * (an already-committed object must match exactly or the retry fails loudly; nothing is ever
 * silently overwritten).
 *
 * The Dump Month's "is it closed yet" check uses the process clock (`Date.now()`), not a
 * database round trip — consistent with every other JST-month boundary calculation in this
 * codebase (db/postgres/partitions/dump-month.ts), and testable the same way the rest of this
 * codebase already stubs time (`vi.spyOn(Date, 'now')`). This is deliberately different from
 * `cleanup-dump-run.ts`'s cleanup-eligibility check, which the migration plan specifically ties
 * to the database's own clock (the same clock that recorded `published_at`).
 */

const assertDumpMonthIsClosed = (dumpMonthText: string, bounds: DumpMonthBoundsUtc): void => {
  if (Date.now() < bounds.upperBoundUtc.getTime()) {
    throw new CommunityDumpPreconditionError(
      `Dump Month ${dumpMonthText} has not fully closed yet (it ends ${bounds.upperBoundUtc.toISOString()}); ` +
        'refusing to publish an open, current, or future month',
    )
  }
}

/**
 * `verifyPostgresSchema` (db/postgres/lifecycle.ts) is reused to ensure the PostgreSQL schema
 * version matches exactly. Its `PostgresQueryClient` port
 * declares a mutable `rows: Array<...>` return shape, while `PartitionQueryClient` (this dump
 * workflow's own port) declares `rows` as `ReadonlyArray<...>` — structurally incompatible by
 * TypeScript's array-variance rules even though every real implementation already returns a
 * genuine mutable array at runtime, so this adapter copies the array once (a cheap shallow copy
 * of row references) purely to satisfy the type checker; no semantics change.
 */
const toPostgresQueryClient = (client: PartitionQueryClient): PostgresQueryClient => ({
  query: async (text, values) => {
    const result = await client.query(text, values)
    return { rows: result.rows.map((row) => row) }
  },
})

export const publishDumpMonth = async (
  pool: DumpPool,
  objectStore: ObjectStore,
  dumpMonth: string,
): Promise<DumpRunRow> => {
  // Fail fast, before connecting to the database, on a malformed or not-yet-closed Dump Month.
  const parts = parseDumpMonth(dumpMonth)
  const bounds = computeDumpMonthBoundsUtc(parts)
  assertDumpMonthIsClosed(parts.text, bounds)

  const client = await pool.connect()
  try {
    await verifyPostgresSchema(toPostgresQueryClient(client))

    const run = await findOrCreateDumpRun(client, {
      dumpMonth: parts,
      schemaVersion: communityDumpManifestSchemaVersion,
    })

    if (
      run.status === 'published' ||
      run.status === 'cleanup_eligible' ||
      run.status === 'cleaned'
    ) {
      return run
    }

    try {
      await setDumpRunStatus(client, run.id, 'exporting', null)
      const exported = await exportDumpMonthPartitions(pool, dumpMonth)

      const manifestFiles: CommunityDumpManifestFileInput[] = []
      for (const file of exported) {
        const objectKey = deriveCommunityDumpDataObjectKey(parts.text, file.dataset)
        await recordDumpFileExport(client, {
          dumpRunId: run.id,
          dataset: file.dataset,
          partitionName: file.partitionName,
          objectKey,
          rowCount: file.rowCount,
          compressedBytes: file.compressedBytes,
          sha256Hex: file.sha256Hex,
        })
        await putImmutableAndVerify(objectStore, objectKey, file.compressed, file.sha256Hex)
        await markDumpFileVerified(client, run.id, file.dataset)
        manifestFiles.push({
          dataset: file.dataset,
          objectKey,
          rowCount: file.rowCount,
          compressedBytes: file.compressedBytes,
          sha256: file.sha256Hex,
        })
      }

      // Reserve the stable publication instant before building the manifest so a retry after
      // this point serializes byte-identical manifest content (plan lines 750-752, 762).
      const publishedAt = await reservePublicationTimestamp(client, run.id)
      const manifest = serializeCommunityDumpManifestV1({
        dumpMonth: parts.text,
        publishedAt,
        files: manifestFiles,
      })
      const manifestBytes = Buffer.from(JSON.stringify(manifest), 'utf8')
      const manifestSha256 = createHash('sha256').update(manifestBytes).digest('hex')
      const manifestObjectKey = deriveCommunityDumpManifestObjectKey(parts.text)

      // Persist the manifest's own bytes/hash before uploading it, per plan lines 750-752.
      await recordManifestMetadata(client, run.id, {
        objectKey: manifestObjectKey,
        bytes: manifestBytes.length,
        sha256Hex: manifestSha256,
      })

      // The verified manifest upload is the publication commit point (plan lines 640, 751-752).
      await putImmutableAndVerify(objectStore, manifestObjectKey, manifestBytes, manifestSha256)

      return await markDumpRunPublished(client, run.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await setDumpRunStatus(client, run.id, 'failed', message)
      throw error
    }
  } finally {
    client.release()
  }
}
