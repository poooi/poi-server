import { createHash } from 'crypto'
import { createWriteStream } from 'fs'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'

import { type CommunityDumpDatasetName } from '../../../dumps/community-dump-dataset-name'
import { createCommunityDumpCompressStream } from '../../../dumps/community-dump-compression'
import { communityDumpDatasets } from '../../../dumps/community-dump-registry'
import { serializeCommunityDumpRecord } from '../../../dumps/community-dump-serializer'
import { encodeNonNegativeSafeInteger } from '../../../dumps/community-dump-values'
import {
  assertExactMonthlyPartitionBounds,
  inspectPartitionCatalog,
  type ExpectedMonthlyPartitionBounds,
} from '../partitions/catalog'
import {
  computeDumpMonthBoundsUtc,
  deriveDefaultPartitionName,
  deriveMonthlyPartitionName,
  parseDumpMonth,
  type DumpMonthBoundsUtc,
  type DumpMonthParts,
} from '../partitions/dump-month'
import { type PartitionQueryClient } from '../partitions/adapter'
import { quoteIdentifier } from '../partitions/sql-safety'
import { type DumpPool, type DumpQueryClient } from './adapter'
import { CommunityDumpPreconditionError, CommunityDumpWorkflowError } from './errors'
import { runRepeatableReadDumpTransaction } from './transaction'

/**
 * Community Dump publish workflow's streaming export phase
 * (docs/postgresql-migration-plan.md lines 740-747, 757-758):
 *
 * 1. Refuse to start if any of the nine default partitions has rows for the target Dump Month.
 * 2. Catalog-prove all nine exact monthly partitions before exporting any of them.
 * 3. In one REPEATABLE READ transaction, stream each partition ordered `(ingested_at, id)`,
 *    encode each row with the existing versioned camelCase serializer, and compress with the
 *    existing streaming Zstandard configuration while counting rows and hashing the compressed
 *    output — never buffering an entire partition's raw JSON Lines text in memory at once.
 * 4. Compare the streamed row count against an exact `count(*)` of the same closed partition.
 *
 * Compressed output for each dataset is accumulated in a per-run temporary directory (removed
 * unconditionally, on every success or failure path) rather than in memory, since the streaming
 * point of this phase is to avoid holding an entire month's uncompressed JSON Lines text at
 * once; once a dataset's compression is complete, its compressed bytes are read back once (they
 * are expected to be far smaller than the raw text) so the object-store port — which only deals
 * in whole `Buffer`s — can upload them in the next phase.
 */

const exportStreamBatchSize = 1000
const tempDirPrefix = 'poi-server-dump-export-'

export interface ExportedDumpPartition {
  readonly dataset: CommunityDumpDatasetName
  readonly table: string
  readonly partitionName: string
  readonly rowCount: number
  readonly compressedBytes: number
  readonly sha256Hex: string
  readonly compressed: Buffer
}

const assertDefaultPartitionHasNoTargetRows = async (
  client: PartitionQueryClient,
  table: string,
  bounds: DumpMonthBoundsUtc,
): Promise<void> => {
  const defaultName = deriveDefaultPartitionName(table)
  const result = await client.query(
    `select 1 from only ${quoteIdentifier(defaultName)} where ingested_at >= $1 and ingested_at < $2 limit 1`,
    [bounds.lowerBoundUtc, bounds.upperBoundUtc],
  )
  if (result.rows.length > 0) {
    throw new CommunityDumpPreconditionError(
      `Default partition "${defaultName}" already has rows for the target Dump Month; publication ` +
        'is blocked until every default partition is empty for this month',
    )
  }
}

/**
 * Validates every one of the nine tables before any of them is exported. Default-partition
 * conflicts are aggregated across all nine tables into one report, matching
 * `createUpcomingMonthPartitions`'s established precedent for this same kind of check
 * (db/postgres/partitions/create-upcoming-month.ts) — a stray-rows problem is common enough to
 * be worth reporting for every affected table at once. A catalog mismatch is a rarer, deeper
 * structural problem, so it is deliberately NOT aggregated: `assertExactMonthlyPartitionBounds`'s
 * `PartitionCatalogMismatchError` propagates immediately and unchanged (see db/postgres/dumps/
 * errors.ts's module doc comment).
 */
const assertAllPartitionsReadyForExport = async (
  client: PartitionQueryClient,
  parts: DumpMonthParts,
  bounds: DumpMonthBoundsUtc,
): Promise<void> => {
  const conflicts: string[] = []
  for (const { table } of communityDumpDatasets) {
    try {
      await assertDefaultPartitionHasNoTargetRows(client, table, bounds)
    } catch (error) {
      conflicts.push(error instanceof Error ? error.message : String(error))
    }
  }
  if (conflicts.length > 0) {
    throw new CommunityDumpPreconditionError(
      `Cannot export Dump Month ${parts.text}: ${conflicts.length} of ${communityDumpDatasets.length} ` +
        `default partition(s) already have rows for the target month:\n${conflicts.join('\n')}`,
    )
  }

  for (const { table } of communityDumpDatasets) {
    const partitionName = deriveMonthlyPartitionName(table, parts)
    const expected: ExpectedMonthlyPartitionBounds = { parentTable: table, ...bounds }
    const info = await inspectPartitionCatalog(client, partitionName)
    assertExactMonthlyPartitionBounds(partitionName, info, expected)
  }
}

const exportSinglePartition = async (
  client: DumpQueryClient,
  tempDir: string,
  dataset: CommunityDumpDatasetName,
  table: string,
  partitionName: string,
): Promise<ExportedDumpPartition> => {
  const tempFilePath = join(tempDir, `${dataset}.jsonl.zst`)
  const rowStream = client.streamQuery(
    `select * from only ${quoteIdentifier(partitionName)} order by ingested_at, id`,
    [],
    exportStreamBatchSize,
  )

  let rowCount = 0
  async function* encodeRows(): AsyncGenerator<Buffer> {
    try {
      for await (const row of rowStream) {
        rowCount++
        yield Buffer.from(serializeCommunityDumpRecord(dataset, row) + '\n', 'utf8')
      }
    } finally {
      rowStream.destroy()
    }
  }

  await pipeline(
    Readable.from(encodeRows()),
    createCommunityDumpCompressStream(),
    createWriteStream(tempFilePath),
  )

  const compressed = await readFile(tempFilePath)
  const sha256Hex = createHash('sha256').update(compressed).digest('hex')

  const countResult = await client.query(
    `select count(*) from only ${quoteIdentifier(partitionName)}`,
  )
  const exactCount = encodeNonNegativeSafeInteger(
    countResult.rows[0]?.count,
    `${partitionName}: count(*)`,
  )
  if (exactCount !== rowCount) {
    throw new CommunityDumpWorkflowError(
      `Partition "${partitionName}" streamed ${rowCount} row(s) while exporting, but an exact ` +
        `count(*) of that closed partition reports ${exactCount}; refusing to publish a mismatched export`,
    )
  }

  return {
    dataset,
    table,
    partitionName,
    rowCount,
    compressedBytes: compressed.length,
    sha256Hex,
    compressed,
  }
}

/**
 * Exports all nine closed Observation partitions for `dumpMonth` (a JST YYYY-MM Dump Month) in
 * one REPEATABLE READ transaction. Rejects (leaving the database and any prior manifest
 * untouched) unless every one of the nine default partitions is empty for the target month and
 * every one of the nine expected monthly partitions is catalog-proven; otherwise streams,
 * encodes, compresses, hashes, and row-counts each partition in Community Dump registry order.
 */
export const exportDumpMonthPartitions = async (
  pool: DumpPool,
  dumpMonth: string,
): Promise<readonly ExportedDumpPartition[]> => {
  // Fail fast on a malformed Dump Month before opening any database connection.
  const parts = parseDumpMonth(dumpMonth)
  const bounds = computeDumpMonthBoundsUtc(parts)

  const tempDir = await mkdtemp(join(tmpdir(), tempDirPrefix))
  try {
    return await runRepeatableReadDumpTransaction(pool, async (client) => {
      await assertAllPartitionsReadyForExport(client, parts, bounds)

      const results: ExportedDumpPartition[] = []
      for (const { dataset, table } of communityDumpDatasets) {
        const partitionName = deriveMonthlyPartitionName(table, parts)
        results.push(await exportSinglePartition(client, tempDir, dataset, table, partitionName))
      }
      return results
    })
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}
