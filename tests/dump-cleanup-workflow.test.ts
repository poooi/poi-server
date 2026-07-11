import { createHash } from 'crypto'

import { describe, expect, test, vi } from 'vitest'

import { cleanupDumpRun } from '../src/db/postgres/dumps/cleanup-dump-run'
import {
  CommunityDumpPreconditionError,
  CommunityDumpVerificationMismatchError,
} from '../src/db/postgres/dumps/errors'
import {
  type PartitionPool,
  type PartitionQueryResult,
} from '../src/db/postgres/partitions/adapter'
import {
  computeDumpMonthBoundsUtc,
  deriveMonthlyPartitionName,
  parseDumpMonth,
} from '../src/db/postgres/partitions/dump-month'
import { PartitionCatalogMismatchError } from '../src/db/postgres/partitions/errors'
import { CommunityDumpError } from '../src/dumps/community-dump-errors'
import {
  communityDumpManifestSchemaVersion,
  serializeCommunityDumpManifestV1,
  type CommunityDumpManifestFileInput,
} from '../src/dumps/community-dump-manifest'
import {
  deriveCommunityDumpDataObjectKey,
  deriveCommunityDumpManifestObjectKey,
} from '../src/dumps/community-dump-object-keys'
import { communityDumpDatasets } from '../src/dumps/community-dump-registry'
import { InMemoryObjectStore } from '../src/object-store/memory-object-store'
import { ObjectNotFoundError, ObjectVerificationError } from '../src/object-store/object-store'

/**
 * Community Dump cleanup workflow (docs/postgresql-migration-plan.md lines 754-765). This suite
 * builds a full in-memory fake `PartitionPool` (following tests/partition-repair-monthly-
 * partition.test.ts's regex-dispatching style) backed by one shared mutable "database" object, so
 * `pool.connect()` can be called twice (once for the read-only verification pass, once inside the
 * final destructive transaction) and both connections observe the same live state — including
 * divergent reads between a plain and a `for update` select, which is how the "metadata race"
 * tests simulate a concurrent writer. The object store is a real `InMemoryObjectStore`, never
 * mocked, so create-only/verification semantics are exercised for real.
 */

const runId = 42
const dumpMonth = '2024-01'
const parts = parseDumpMonth(dumpMonth)
const bounds = computeDumpMonthBoundsUtc(parts)
const publishedAt = new Date('2024-02-05T00:00:00.000Z')
const cleanupEligibleAt = new Date(publishedAt.getTime() + 7 * 24 * 60 * 60 * 1000)
const verifiedAt = new Date('2024-02-01T00:00:00.000Z')

// The nine "stateful" (Current State/Aggregate/Definition/Fact) tables that cleanup must never
// reference, mirroring src/db/postgres/schema.ts's pgTable names outside the nine Observation
// report tables.
const statefulTableNames = [
  'select_rank_records',
  'recipe_records',
  'ship_stats',
  'enemy_infos',
  'quests',
  'quest_rewards',
  'item_improvement_availability_facts',
  'item_improvement_cost_facts',
  'item_improvement_update_facts',
]

interface DataFileFixture {
  readonly dataset: string
  readonly table: string
  readonly partitionName: string
  readonly objectKey: string
  readonly compressed: Buffer
  readonly sha256Hex: string
  readonly rowCount: number
  readonly compressedBytes: number
}

const dataFileFixtures: readonly DataFileFixture[] = communityDumpDatasets.map((definition) => {
  const compressed = Buffer.from(`fake-compressed-content-for-${definition.dataset}`, 'utf8')
  return {
    dataset: definition.dataset,
    table: definition.table,
    partitionName: deriveMonthlyPartitionName(definition.table, parts),
    objectKey: deriveCommunityDumpDataObjectKey(dumpMonth, definition.dataset),
    compressed,
    sha256Hex: createHash('sha256').update(compressed).digest('hex'),
    rowCount: 3,
    compressedBytes: compressed.length,
  }
})

const manifestFilesInput: CommunityDumpManifestFileInput[] = dataFileFixtures.map((file) => ({
  dataset: file.dataset,
  objectKey: file.objectKey,
  rowCount: file.rowCount,
  compressedBytes: file.compressedBytes,
  sha256: file.sha256Hex,
}))

interface ManifestVariantOverrides {
  readonly dumpMonth?: string
  readonly publishedAt?: unknown
  readonly files?: readonly CommunityDumpManifestFileInput[]
}

const buildManifestBytes = (overrides: ManifestVariantOverrides = {}) => {
  const manifest = serializeCommunityDumpManifestV1({
    dumpMonth: overrides.dumpMonth ?? dumpMonth,
    publishedAt: overrides.publishedAt ?? publishedAt,
    files: overrides.files ?? manifestFilesInput,
  })
  const bytes = Buffer.from(JSON.stringify(manifest), 'utf8')
  return { manifest, bytes, sha256Hex: createHash('sha256').update(bytes).digest('hex') }
}

const happyManifest = buildManifestBytes()
const manifestObjectKey = deriveCommunityDumpManifestObjectKey(dumpMonth)

interface FakeRunRow {
  id: number
  dumpMonth: string
  schemaVersion: number
  status: string
  manifestObjectKey: string | null
  manifestBytes: number | null
  manifestSha256: string | null
  publishedAt: Date | null
  cleanupEligibleAt: Date | null
  cleanedAt: Date | null
  error: string | null
}

interface FakeFileRow {
  id: number
  dumpRunId: number
  dataset: string
  partitionName: string
  objectKey: string
  rowCount: number
  compressedBytes: number
  sha256: string
  verifiedAt: Date | null
}

const buildHappyRun = (overrides: Partial<FakeRunRow> = {}): FakeRunRow => ({
  id: runId,
  dumpMonth,
  schemaVersion: communityDumpManifestSchemaVersion,
  status: 'cleanup_eligible',
  manifestObjectKey,
  manifestBytes: happyManifest.bytes.length,
  manifestSha256: happyManifest.sha256Hex,
  publishedAt,
  cleanupEligibleAt,
  cleanedAt: null,
  error: null,
  ...overrides,
})

const buildHappyFiles = (): FakeFileRow[] =>
  dataFileFixtures.map((file, index) => ({
    id: index + 1,
    dumpRunId: runId,
    dataset: file.dataset,
    partitionName: file.partitionName,
    objectKey: file.objectKey,
    rowCount: file.rowCount,
    compressedBytes: file.compressedBytes,
    sha256: file.sha256Hex,
    verifiedAt,
  }))

const rawRunRow = (run: FakeRunRow): Record<string, unknown> => ({
  id: String(run.id),
  dump_month: run.dumpMonth,
  schema_version: run.schemaVersion,
  status: run.status,
  manifest_object_key: run.manifestObjectKey,
  manifest_bytes: run.manifestBytes === null ? null : String(run.manifestBytes),
  manifest_sha256: run.manifestSha256 === null ? null : Buffer.from(run.manifestSha256, 'hex'),
  published_at: run.publishedAt,
  cleanup_eligible_at: run.cleanupEligibleAt,
  cleaned_at: run.cleanedAt,
  error: run.error,
})

const rawFileRow = (file: FakeFileRow): Record<string, unknown> => ({
  id: String(file.id),
  dump_run_id: String(file.dumpRunId),
  dataset: file.dataset,
  partition_name: file.partitionName,
  object_key: file.objectKey,
  row_count: String(file.rowCount),
  compressed_bytes: String(file.compressedBytes),
  sha256: Buffer.from(file.sha256, 'hex'),
  verified_at: file.verifiedAt,
})

interface FakePartitionInfo {
  parentTable: string
  lowerBoundUtc: Date
  upperBoundUtc: Date
}

interface FakeDatabase {
  schemaVersion: number
  run: FakeRunRow | null
  files: FakeFileRow[]
  now: Date
  partitions: Map<string, FakePartitionInfo>
}

type QueryOverride = (
  text: string,
  values: readonly unknown[] | undefined,
  database: FakeDatabase,
) => PartitionQueryResult | undefined

const emptyResult: PartitionQueryResult = { rows: [], rowCount: 0 }

const catalogRowFor = (info: FakePartitionInfo): Record<string, unknown> => ({
  parent_table: info.parentTable,
  is_default_partition: false,
  bound_expression: `FOR VALUES FROM ('${info.lowerBoundUtc.toISOString()}') TO ('${info.upperBoundUtc.toISOString()}')`,
  lower_bound: info.lowerBoundUtc,
  upper_bound: info.upperBoundUtc,
})

const detachPattern = /alter table "([a-z_][a-z0-9_]*)" detach partition "([a-z_][a-z0-9_]*)"/i
const dropTablePattern = /^drop table "([a-z_][a-z0-9_]*)"$/i

const defaultPartitions = (): Map<string, FakePartitionInfo> =>
  new Map(
    dataFileFixtures.map((file) => [
      file.partitionName,
      {
        parentTable: file.table,
        lowerBoundUtc: bounds.lowerBoundUtc,
        upperBoundUtc: bounds.upperBoundUtc,
      },
    ]),
  )

const createFakeCleanupDatabase = (
  options: {
    run?: FakeRunRow | null
    files?: FakeFileRow[]
    now?: Date
    overrides?: readonly QueryOverride[]
  } = {},
): {
  pool: PartitionPool
  database: FakeDatabase
  calls: string[]
  clients: Array<{ release: ReturnType<typeof vi.fn> }>
} => {
  const database: FakeDatabase = {
    schemaVersion: 2,
    run: options.run === undefined ? buildHappyRun() : options.run,
    files: options.files ?? buildHappyFiles(),
    now: options.now ?? cleanupEligibleAt,
    partitions: defaultPartitions(),
  }

  const calls: string[] = []
  const clients: Array<{ release: ReturnType<typeof vi.fn> }> = []

  const query = vi.fn(
    async (text: string, values?: readonly unknown[]): Promise<PartitionQueryResult> => {
      calls.push(text)
      const normalized = text.trim()
      const lower = normalized.toLowerCase()

      for (const override of options.overrides ?? []) {
        const overridden = override(normalized, values, database)
        if (overridden) return overridden
      }

      if (lower === 'select version from schema_metadata where singleton = true') {
        return { rows: [{ version: database.schemaVersion }], rowCount: 1 }
      }
      if (lower === 'select clock_timestamp() as now') {
        return { rows: [{ now: database.now }], rowCount: 1 }
      }
      if (lower === 'begin' || lower === 'commit' || lower === 'rollback') {
        return emptyResult
      }
      if (lower.includes('pg_advisory_xact_lock')) {
        return emptyResult
      }
      if (lower.includes('from data_dump_runs where id = $1')) {
        if (!database.run || String(values?.[0]) !== String(database.run.id)) return emptyResult
        return { rows: [rawRunRow(database.run)], rowCount: 1 }
      }
      if (lower.includes('from data_dump_files where dump_run_id = $1')) {
        const matching = database.files.filter(
          (file) => String(file.dumpRunId) === String(values?.[0]),
        )
        return { rows: matching.map(rawFileRow), rowCount: matching.length }
      }
      if (lower.includes('pg_catalog.pg_class')) {
        const relationName = values?.[0]
        if (typeof relationName !== 'string') {
          throw new Error('test fake: expected a relation name parameter')
        }
        const info = database.partitions.get(relationName)
        return info ? { rows: [catalogRowFor(info)], rowCount: 1 } : emptyResult
      }
      const detach = detachPattern.exec(normalized)
      if (detach) {
        const [, parentTable, partitionName] = detach
        const info = database.partitions.get(partitionName)
        if (!info || info.parentTable !== parentTable) {
          throw new Error(`test fake: detach referenced unknown partition/parent: ${normalized}`)
        }
        return emptyResult
      }
      const drop = dropTablePattern.exec(normalized)
      if (drop) {
        database.partitions.delete(drop[1])
        return emptyResult
      }
      if (lower.includes('update data_dump_runs') && lower.includes("status = 'cleaned'")) {
        if (!database.run) throw new Error('test fake: no run to mark cleaned')
        database.run = { ...database.run, status: 'cleaned', cleanedAt: database.now, error: null }
        return { rows: [rawRunRow(database.run)], rowCount: 1 }
      }

      throw new Error(`Unexpected query in test fake: ${normalized}`)
    },
  )

  const pool: PartitionPool = {
    connect: vi.fn(async () => {
      const release = vi.fn()
      clients.push({ release })
      return { query, release }
    }),
  }

  return { pool, database, calls, clients }
}

const buildHappyObjectStore = (options: { skipManifest?: boolean } = {}): InMemoryObjectStore => {
  const store = new InMemoryObjectStore()
  for (const file of dataFileFixtures) {
    void store.putIfAbsent(file.objectKey, file.compressed)
  }
  if (!options.skipManifest) {
    void store.putIfAbsent(manifestObjectKey, happyManifest.bytes)
  }
  return store
}

const ddlCalls = (calls: readonly string[]): string[] =>
  calls.filter((call) => detachPattern.test(call) || dropTablePattern.test(call.trim()))

describe('cleanupDumpRun', () => {
  test.each([
    ['a negative number', -1],
    ['zero', 0],
    ['a non-integer number', 1.5],
    ['NaN', NaN],
    ['a wildcard string', '*'],
    ['a bare table name', 'data_dump_runs'],
    ['an object', { id: 42 }],
    ['a boolean', true],
  ])('rejects %s as runId without connecting to the database', async (_label, badRunId) => {
    const { pool } = createFakeCleanupDatabase()
    const objectStore = buildHappyObjectStore()

    await expect(cleanupDumpRun(pool, objectStore, badRunId)).rejects.toThrow(CommunityDumpError)
    expect(pool.connect).not.toHaveBeenCalled()
  })

  test('rejects when no data_dump_runs row exists with the exact id', async () => {
    const { pool } = createFakeCleanupDatabase({ run: null })
    const objectStore = buildHappyObjectStore()

    await expect(cleanupDumpRun(pool, objectStore, runId)).rejects.toThrow(
      CommunityDumpPreconditionError,
    )
  })

  test('rejects when the run was recorded under a different schema version', async () => {
    const { pool } = createFakeCleanupDatabase({ run: buildHappyRun({ schemaVersion: 2 }) })
    const objectStore = buildHappyObjectStore()

    await expect(cleanupDumpRun(pool, objectStore, runId)).rejects.toThrow(
      CommunityDumpPreconditionError,
    )
  })

  test.each(['pending', 'exporting', 'uploaded', 'failed'])(
    'rejects a run with status "%s"',
    async (status) => {
      const { pool } = createFakeCleanupDatabase({ run: buildHappyRun({ status }) })
      const objectStore = buildHappyObjectStore()

      await expect(cleanupDumpRun(pool, objectStore, runId)).rejects.toThrow(
        CommunityDumpPreconditionError,
      )
    },
  )

  test.each([
    ['manifestObjectKey', { manifestObjectKey: null }],
    ['manifestBytes', { manifestBytes: null }],
    ['manifestSha256', { manifestSha256: null }],
    ['publishedAt', { publishedAt: null }],
    ['cleanupEligibleAt', { cleanupEligibleAt: null }],
  ])('rejects a published run missing %s', async (_field, overrides) => {
    const { pool } = createFakeCleanupDatabase({ run: buildHappyRun(overrides) })
    const objectStore = buildHappyObjectStore()

    await expect(cleanupDumpRun(pool, objectStore, runId)).rejects.toThrow(
      CommunityDumpPreconditionError,
    )
  })

  test('rejects a run whose manifest object key is not the deterministic key for its month', async () => {
    const { pool } = createFakeCleanupDatabase({
      run: buildHappyRun({ manifestObjectKey: 'months/wrong/manifest.json' }),
    })

    await expect(cleanupDumpRun(pool, buildHappyObjectStore(), runId)).rejects.toThrow(
      CommunityDumpVerificationMismatchError,
    )
  })

  test('rejects incoherent publication and cleanup eligibility timestamps', async () => {
    const { pool } = createFakeCleanupDatabase({
      run: buildHappyRun({ cleanupEligibleAt: new Date('2024-02-09T00:00:00.000Z') }),
    })

    await expect(cleanupDumpRun(pool, buildHappyObjectStore(), runId)).rejects.toThrow(
      CommunityDumpVerificationMismatchError,
    )
  })

  test('refuses cleanup before the grace period has elapsed, per the database clock', async () => {
    const { pool, calls } = createFakeCleanupDatabase({
      now: new Date(cleanupEligibleAt.getTime() - 1),
    })
    const objectStore = buildHappyObjectStore()

    await expect(cleanupDumpRun(pool, objectStore, runId)).rejects.toThrow(
      CommunityDumpPreconditionError,
    )
    expect(calls.some((call) => call.toLowerCase().includes('begin'))).toBe(false)
  })

  test('is unaffected by the process clock when checking grace-period eligibility', async () => {
    // The database clock reports "eligible", even though the process clock (Date.now()) would
    // disagree if it were consulted instead. Success here proves only clock_timestamp() is used.
    vi.spyOn(Date, 'now').mockReturnValue(cleanupEligibleAt.getTime() - 1_000_000)
    try {
      const { pool } = createFakeCleanupDatabase({ now: cleanupEligibleAt })
      const objectStore = buildHappyObjectStore()

      const result = await cleanupDumpRun(pool, objectStore, runId)

      expect(result.action).toBe('cleaned')
    } finally {
      vi.restoreAllMocks()
    }
  })

  test('rejects when fewer than nine data_dump_files rows are recorded', async () => {
    const { pool } = createFakeCleanupDatabase({ files: buildHappyFiles().slice(1) })
    const objectStore = buildHappyObjectStore()

    await expect(cleanupDumpRun(pool, objectStore, runId)).rejects.toThrow(
      CommunityDumpVerificationMismatchError,
    )
  })

  test('rejects when a dataset has a duplicate data_dump_files row', async () => {
    const files = buildHappyFiles()
    files.push({ ...files[0], id: 999 })
    const { pool } = createFakeCleanupDatabase({ files })
    const objectStore = buildHappyObjectStore()

    await expect(cleanupDumpRun(pool, objectStore, runId)).rejects.toThrow(
      CommunityDumpVerificationMismatchError,
    )
  })

  test('rejects when a data_dump_files row has an unknown dataset', async () => {
    const files = buildHappyFiles()
    files[0] = { ...files[0], dataset: 'unknownObservations' }
    const { pool } = createFakeCleanupDatabase({ files })
    const objectStore = buildHappyObjectStore()

    await expect(cleanupDumpRun(pool, objectStore, runId)).rejects.toThrow(
      CommunityDumpVerificationMismatchError,
    )
  })

  test('rejects when a data_dump_files row has never been verified', async () => {
    const files = buildHappyFiles()
    files[0] = { ...files[0], verifiedAt: null }
    const { pool } = createFakeCleanupDatabase({ files })
    const objectStore = buildHappyObjectStore()

    await expect(cleanupDumpRun(pool, objectStore, runId)).rejects.toThrow(
      CommunityDumpVerificationMismatchError,
    )
  })

  test('rejects when a data_dump_files row has the wrong immutable object key', async () => {
    const files = buildHappyFiles()
    files[0] = { ...files[0], objectKey: 'months/2024-01/v1/wrong.jsonl.zst' }
    const { pool } = createFakeCleanupDatabase({ files })
    const objectStore = buildHappyObjectStore()

    await expect(cleanupDumpRun(pool, objectStore, runId)).rejects.toThrow(
      CommunityDumpVerificationMismatchError,
    )
  })

  test('rejects when a data_dump_files row has the wrong monthly partition name', async () => {
    const files = buildHappyFiles()
    files[0] = { ...files[0], partitionName: 'create_ship_records_2099_12' }
    const { pool } = createFakeCleanupDatabase({ files })
    const objectStore = buildHappyObjectStore()

    await expect(cleanupDumpRun(pool, objectStore, runId)).rejects.toThrow(
      CommunityDumpVerificationMismatchError,
    )
  })

  test('rejects when the manifest object is missing from the object store', async () => {
    const { pool } = createFakeCleanupDatabase()
    const objectStore = buildHappyObjectStore({ skipManifest: true })

    await expect(cleanupDumpRun(pool, objectStore, runId)).rejects.toThrow(ObjectNotFoundError)
  })

  test('rejects when the stored manifest no longer matches its recorded digest/size', async () => {
    const { pool } = createFakeCleanupDatabase()
    const objectStore = buildHappyObjectStore({ skipManifest: true })
    await objectStore.putIfAbsent(manifestObjectKey, Buffer.from('corrupted manifest bytes'))

    await expect(cleanupDumpRun(pool, objectStore, runId)).rejects.toThrow(ObjectVerificationError)
  })

  test('rejects when the stored manifest bytes are not valid JSON', async () => {
    const garbage = Buffer.from('not valid json{{{', 'utf8')
    const { pool } = createFakeCleanupDatabase({
      run: buildHappyRun({
        manifestBytes: garbage.length,
        manifestSha256: createHash('sha256').update(garbage).digest('hex'),
      }),
    })
    const objectStore = buildHappyObjectStore({ skipManifest: true })
    await objectStore.putIfAbsent(manifestObjectKey, garbage)

    await expect(cleanupDumpRun(pool, objectStore, runId)).rejects.toThrow(CommunityDumpError)
  })

  test('rejects when the stored manifest has the wrong internal schemaVersion', async () => {
    const manifest = buildManifestBytes()
    const tampered = { ...manifest.manifest, schemaVersion: 2 }
    const bytes = Buffer.from(JSON.stringify(tampered), 'utf8')
    const { pool } = createFakeCleanupDatabase({
      run: buildHappyRun({
        manifestBytes: bytes.length,
        manifestSha256: createHash('sha256').update(bytes).digest('hex'),
      }),
    })
    const objectStore = buildHappyObjectStore({ skipManifest: true })
    await objectStore.putIfAbsent(manifestObjectKey, bytes)

    await expect(cleanupDumpRun(pool, objectStore, runId)).rejects.toThrow(CommunityDumpError)
  })

  test('rejects when the stored manifest has the wrong internal timezone', async () => {
    const manifest = buildManifestBytes()
    const tampered = { ...manifest.manifest, timezone: 'UTC' }
    const bytes = Buffer.from(JSON.stringify(tampered), 'utf8')
    const { pool } = createFakeCleanupDatabase({
      run: buildHappyRun({
        manifestBytes: bytes.length,
        manifestSha256: createHash('sha256').update(bytes).digest('hex'),
      }),
    })
    const objectStore = buildHappyObjectStore({ skipManifest: true })
    await objectStore.putIfAbsent(manifestObjectKey, bytes)

    await expect(cleanupDumpRun(pool, objectStore, runId)).rejects.toThrow(CommunityDumpError)
  })

  test.each([
    ['dumpMonth', { dumpMonth: '2024-02' }],
    ['publishedAt', { publishedAt: new Date('2024-03-01T00:00:00.000Z') }],
  ])('rejects when the manifest %s does not match the run', async (_label, overrides) => {
    const variant = buildManifestBytes(overrides)
    const { pool } = createFakeCleanupDatabase({
      run: buildHappyRun({
        manifestBytes: variant.bytes.length,
        manifestSha256: variant.sha256Hex,
      }),
    })
    const objectStore = buildHappyObjectStore({ skipManifest: true })
    await objectStore.putIfAbsent(manifestObjectKey, variant.bytes)

    await expect(cleanupDumpRun(pool, objectStore, runId)).rejects.toThrow(
      CommunityDumpVerificationMismatchError,
    )
  })

  test('rejects when one manifest file entry does not match its data_dump_files row', async () => {
    const mutatedFiles = manifestFilesInput.map((file, index) =>
      index === 0 ? { ...file, sha256: '0'.repeat(64) } : file,
    )
    const variant = buildManifestBytes({ files: mutatedFiles })
    const { pool } = createFakeCleanupDatabase({
      run: buildHappyRun({
        manifestBytes: variant.bytes.length,
        manifestSha256: variant.sha256Hex,
      }),
    })
    const objectStore = buildHappyObjectStore({ skipManifest: true })
    await objectStore.putIfAbsent(manifestObjectKey, variant.bytes)

    await expect(cleanupDumpRun(pool, objectStore, runId)).rejects.toThrow(
      CommunityDumpVerificationMismatchError,
    )
  })

  test('rejects when a referenced data object is missing from the object store', async () => {
    const { pool } = createFakeCleanupDatabase()
    const objectStore = buildHappyObjectStore()
    // Rebuild the store without the first dataset's data object.
    const missingKey = dataFileFixtures[0].objectKey
    const freshStore = new InMemoryObjectStore()
    for (const file of dataFileFixtures) {
      if (file.objectKey === missingKey) continue
      await freshStore.putIfAbsent(file.objectKey, file.compressed)
    }
    await freshStore.putIfAbsent(manifestObjectKey, happyManifest.bytes)
    void objectStore

    await expect(cleanupDumpRun(pool, freshStore, runId)).rejects.toThrow(ObjectNotFoundError)
  })

  test('rejects when a referenced data object no longer matches its recorded digest/size', async () => {
    const { pool } = createFakeCleanupDatabase()
    const objectStore = buildHappyObjectStore()
    const corruptedKey = dataFileFixtures[0].objectKey
    const freshStore = new InMemoryObjectStore()
    for (const file of dataFileFixtures) {
      const bytes = file.objectKey === corruptedKey ? Buffer.from('corrupted') : file.compressed
      await freshStore.putIfAbsent(file.objectKey, bytes)
    }
    await freshStore.putIfAbsent(manifestObjectKey, happyManifest.bytes)
    void objectStore

    await expect(cleanupDumpRun(pool, freshStore, runId)).rejects.toThrow(ObjectVerificationError)
  })

  test('rolls back and issues no DDL when a partition fails catalog proof', async () => {
    const { pool, calls, database } = createFakeCleanupDatabase()
    database.partitions.set(dataFileFixtures[0].partitionName, {
      parentTable: dataFileFixtures[0].table,
      lowerBoundUtc: new Date('2099-01-01T00:00:00.000Z'),
      upperBoundUtc: new Date('2099-02-01T00:00:00.000Z'),
    })
    const objectStore = buildHappyObjectStore()

    await expect(cleanupDumpRun(pool, objectStore, runId)).rejects.toThrow(
      PartitionCatalogMismatchError,
    )
    expect(ddlCalls(calls)).toHaveLength(0)
    expect(calls.some((call) => call.trim().toLowerCase() === 'rollback')).toBe(true)
    // Every partition (including the ones proven fine before the mismatch was found) survives.
    expect(database.partitions.size).toBe(9)
  })

  test('rolls back and issues no DDL when the run metadata changed before the destructive transaction', async () => {
    const overrides: QueryOverride[] = [
      (text, _values, db) => {
        if (
          text.toLowerCase().includes('from data_dump_runs where id = $1') &&
          text.trim().toLowerCase().endsWith('for update') &&
          db.run
        ) {
          return { rows: [rawRunRow({ ...db.run, manifestSha256: 'f'.repeat(64) })], rowCount: 1 }
        }
        return undefined
      },
    ]
    const { pool, calls, database } = createFakeCleanupDatabase({ overrides })
    const objectStore = buildHappyObjectStore()

    await expect(cleanupDumpRun(pool, objectStore, runId)).rejects.toThrow(
      CommunityDumpVerificationMismatchError,
    )
    expect(ddlCalls(calls)).toHaveLength(0)
    expect(database.partitions.size).toBe(9)
  })

  test('rolls back and issues no DDL when a file row changed before the destructive transaction', async () => {
    const overrides: QueryOverride[] = [
      (text, _values, db) => {
        if (
          text.toLowerCase().includes('from data_dump_files where dump_run_id = $1') &&
          text.trim().toLowerCase().endsWith('for update')
        ) {
          const mutated = db.files.map((file, index) =>
            index === 0 ? { ...file, verifiedAt: null } : file,
          )
          return { rows: mutated.map(rawFileRow), rowCount: mutated.length }
        }
        return undefined
      },
    ]
    const { pool, calls, database } = createFakeCleanupDatabase({ overrides })
    const objectStore = buildHappyObjectStore()

    await expect(cleanupDumpRun(pool, objectStore, runId)).rejects.toThrow(
      CommunityDumpVerificationMismatchError,
    )
    expect(ddlCalls(calls)).toHaveLength(0)
    expect(database.partitions.size).toBe(9)
  })

  test('never issues SQL that references any stateful Current State/Aggregate/Definition/Fact table', async () => {
    const { pool, calls } = createFakeCleanupDatabase()
    const objectStore = buildHappyObjectStore()

    await cleanupDumpRun(pool, objectStore, runId)

    const allSql = calls.join('\n').toLowerCase()
    for (const statefulTable of statefulTableNames) {
      expect(allSql).not.toContain(statefulTable)
    }
  })

  test('detaches and drops exactly the nine expected partitions, marks the run cleaned, and returns them', async () => {
    const { pool, calls, database, clients } = createFakeCleanupDatabase()
    const objectStore = buildHappyObjectStore()

    const result = await cleanupDumpRun(pool, objectStore, runId)

    expect(result.action).toBe('cleaned')
    expect(result.runId).toBe(runId)
    expect(result.partitionsDropped.slice().sort()).toEqual(
      dataFileFixtures.map((file) => file.partitionName).sort(),
    )

    const detachCalls = calls.filter((call) => detachPattern.test(call))
    const dropCalls = calls.filter((call) => dropTablePattern.test(call.trim()))
    expect(detachCalls).toHaveLength(9)
    expect(dropCalls).toHaveLength(9)
    for (const file of dataFileFixtures) {
      expect(
        detachCalls.some(
          (call) => call.includes(`"${file.table}"`) && call.includes(`"${file.partitionName}"`),
        ),
      ).toBe(true)
      expect(dropCalls.some((call) => call.includes(`"${file.partitionName}"`))).toBe(true)
    }

    expect(database.partitions.size).toBe(0)
    expect(database.run?.status).toBe('cleaned')

    expect(calls.some((call) => call.trim().toLowerCase() === 'commit')).toBe(true)
    expect(calls.some((call) => call.trim().toLowerCase() === 'rollback')).toBe(false)
    expect(clients.length).toBe(2)
    for (const client of clients) {
      expect(client.release).toHaveBeenCalledTimes(1)
    }
  })

  test('is idempotent: an already-cleaned coherent run returns already-cleaned without object reads or DDL', async () => {
    const { pool, calls, clients } = createFakeCleanupDatabase({
      run: buildHappyRun({ status: 'cleaned', cleanedAt: new Date('2024-02-20T00:00:00.000Z') }),
    })
    const objectStore = buildHappyObjectStore()
    const getObjectSpy = vi.spyOn(objectStore, 'getObject')

    const result = await cleanupDumpRun(pool, objectStore, runId)

    expect(result).toEqual({ runId, action: 'already-cleaned', partitionsDropped: [] })
    expect(getObjectSpy).not.toHaveBeenCalled()
    expect(ddlCalls(calls)).toHaveLength(0)
    expect(calls.some((call) => call.trim().toLowerCase() === 'begin')).toBe(false)
    expect(calls.some((call) => call.toLowerCase().includes('pg_advisory_xact_lock'))).toBe(false)
    expect(calls.some((call) => call.toLowerCase().includes('clock_timestamp'))).toBe(false)
    expect(clients.length).toBe(1)
  })

  test('rejects an already-cleaned run whose recorded metadata is incoherent', async () => {
    const { pool } = createFakeCleanupDatabase({
      run: buildHappyRun({
        status: 'cleaned',
        cleanedAt: new Date('2024-02-20T00:00:00.000Z'),
        manifestObjectKey: null,
      }),
    })
    const objectStore = buildHappyObjectStore()

    await expect(cleanupDumpRun(pool, objectStore, runId)).rejects.toThrow(
      CommunityDumpPreconditionError,
    )
  })

  test('rejects an already-cleaned run whose data_dump_files no longer pass exact-file validation', async () => {
    const files = buildHappyFiles().slice(1)
    const { pool } = createFakeCleanupDatabase({
      run: buildHappyRun({ status: 'cleaned', cleanedAt: new Date('2024-02-20T00:00:00.000Z') }),
      files,
    })
    const objectStore = buildHappyObjectStore()

    await expect(cleanupDumpRun(pool, objectStore, runId)).rejects.toThrow(
      CommunityDumpVerificationMismatchError,
    )
  })
})
