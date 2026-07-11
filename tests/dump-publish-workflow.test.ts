import { createHash } from 'crypto'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const lifecycleMocks = vi.hoisted(() => ({
  verifyPostgresDatabase: vi.fn(),
}))
vi.mock('../src/db/postgres/lifecycle', () => ({
  verifyPostgresDatabase: lifecycleMocks.verifyPostgresDatabase,
}))

const repositoryMocks = vi.hoisted(() => ({
  findOrCreateDumpRun: vi.fn(),
  setDumpRunStatus: vi.fn(),
  reservePublicationTimestamp: vi.fn(),
  recordManifestMetadata: vi.fn(),
  markDumpRunPublished: vi.fn(),
  recordDumpFileExport: vi.fn(),
  markDumpFileVerified: vi.fn(),
}))
vi.mock('../src/db/postgres/dumps/dump-run-repository', () => repositoryMocks)

const exportMocks = vi.hoisted(() => ({
  exportDumpMonthPartitions: vi.fn(),
}))
vi.mock('../src/db/postgres/dumps/export-partitions', () => exportMocks)

import { type DataEpoch } from '../src/contracts/database'
import { type DumpPool, type DumpPoolClient } from '../src/db/postgres/dumps/adapter'
import { type ExportedDumpPartition } from '../src/db/postgres/dumps/export-partitions'
import { publishDumpMonth } from '../src/db/postgres/dumps/publish-dump-month'
import { type DumpFileRow, type DumpRunRow } from '../src/db/postgres/dumps/dump-run-repository'
import {
  computeDumpMonthBoundsUtc,
  deriveMonthlyPartitionName,
  parseDumpMonth,
} from '../src/db/postgres/partitions/dump-month'
import {
  communityDumpManifestSchemaVersion,
  parseCommunityDumpManifestV1,
} from '../src/dumps/community-dump-manifest'

import {
  deriveCommunityDumpDataObjectKey,
  deriveCommunityDumpManifestObjectKey,
} from '../src/dumps/community-dump-object-keys'
import { communityDumpDatasets } from '../src/dumps/community-dump-registry'
import { InMemoryObjectStore } from '../src/object-store/memory-object-store'
import { ObjectVerificationError } from '../src/object-store/object-store'

const dumpMonth = '2098-05'
const parts = parseDumpMonth(dumpMonth)
const bounds = computeDumpMonthBoundsUtc(parts)
const fakeEpoch: DataEpoch = {
  id: '00000000-0000-4000-8000-000000000001',
  startedAt: '2098-01-01T00:00:00.000Z',
}

const buildFakeExportedPartitions = (): ExportedDumpPartition[] =>
  communityDumpDatasets.map((definition) => {
    const compressed = Buffer.from(`fake-compressed-content-for-${definition.dataset}`, 'utf8')
    return {
      dataset: definition.dataset,
      table: definition.table,
      partitionName: deriveMonthlyPartitionName(definition.table, parts),
      rowCount: 3,
      compressedBytes: compressed.length,
      sha256Hex: createHash('sha256').update(compressed).digest('hex'),
      compressed,
    }
  })

const fakePendingRun: DumpRunRow = {
  id: 42,
  epochId: fakeEpoch.id,
  dumpMonth: parts.text,
  schemaVersion: communityDumpManifestSchemaVersion,
  status: 'pending',
  manifestObjectKey: null,
  manifestBytes: null,
  manifestSha256: null,
  publishedAt: null,
  cleanupEligibleAt: null,
  cleanedAt: null,
  error: null,
}

const fakeDumpFileRow: DumpFileRow = {
  id: 1,
  dumpRunId: 42,
  dataset: 'createShipObservations',
  partitionName: 'create_ship_records_2098_05',
  objectKey: 'ignored',
  rowCount: 3,
  compressedBytes: 10,
  sha256: 'a'.repeat(64),
  verifiedAt: new Date('2098-06-01T00:00:00.000Z'),
}

const reservedPublishedAt = new Date('2098-06-10T00:00:00.000Z')
const cleanupEligibleAt = new Date('2098-06-17T00:00:00.000Z')

const fakePublishedRun: DumpRunRow = {
  ...fakePendingRun,
  status: 'published',
  publishedAt: reservedPublishedAt,
  cleanupEligibleAt,
  manifestObjectKey: deriveCommunityDumpManifestObjectKey(fakeEpoch.id, dumpMonth),
}

const createFakePool = (): DumpPool => {
  const client: DumpPoolClient = {
    query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
    streamQuery: vi.fn(),
    release: vi.fn(),
  }
  return { connect: vi.fn(async () => client) }
}

// Community Dump publish workflow orchestrator (docs/postgresql-migration-plan.md lines
// 740-753, 761-762). PostgreSQL-facing collaborators (lifecycle epoch/schema verification, the
// data_dump_runs/data_dump_files repository, and the streaming export phase) are mocked at the
// module level since each already has its own dedicated, thorough test suite; this suite only
// verifies the orchestrator's own control flow. The object-store port and manifest serializer are
// deliberately left real (backed by `InMemoryObjectStore`) so upload/create-only/verification
// behavior is exercised for real, not re-described as another mock.
describe('publishDumpMonth', () => {
  beforeEach(() => {
    // Default "now" is safely after the fixed test Dump Month closes; the two refusal tests
    // below override this to simulate an open/current or future month.
    vi.spyOn(Date, 'now').mockReturnValue(bounds.upperBoundUtc.getTime() + 24 * 60 * 60 * 1000)
    lifecycleMocks.verifyPostgresDatabase.mockResolvedValue(fakeEpoch)
    repositoryMocks.findOrCreateDumpRun.mockResolvedValue(fakePendingRun)
    repositoryMocks.setDumpRunStatus.mockResolvedValue(fakePendingRun)
    repositoryMocks.reservePublicationTimestamp.mockResolvedValue(reservedPublishedAt)
    repositoryMocks.recordManifestMetadata.mockResolvedValue(fakePendingRun)
    repositoryMocks.markDumpRunPublished.mockResolvedValue(fakePublishedRun)
    repositoryMocks.recordDumpFileExport.mockResolvedValue(fakeDumpFileRow)
    repositoryMocks.markDumpFileVerified.mockResolvedValue(fakeDumpFileRow)
    exportMocks.exportDumpMonthPartitions.mockResolvedValue(buildFakeExportedPartitions())
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  test('publishes all nine datasets, uploads a verified manifest, and returns the published run', async () => {
    const pool = createFakePool()
    const objectStore = new InMemoryObjectStore()

    const result = await publishDumpMonth(pool, objectStore, dumpMonth)

    expect(result.status).toBe('published')
    expect(repositoryMocks.recordDumpFileExport).toHaveBeenCalledTimes(9)
    expect(repositoryMocks.markDumpFileVerified).toHaveBeenCalledTimes(9)

    for (const definition of communityDumpDatasets) {
      const objectKey = deriveCommunityDumpDataObjectKey(
        fakeEpoch.id,
        dumpMonth,
        definition.dataset,
      )
      expect(objectStore.has(objectKey)).toBe(true)
    }

    const manifestObjectKey = deriveCommunityDumpManifestObjectKey(fakeEpoch.id, dumpMonth)
    expect(objectStore.has(manifestObjectKey)).toBe(true)
    const manifestBytes = await objectStore.getObject(manifestObjectKey)
    const manifest = parseCommunityDumpManifestV1(manifestBytes)
    expect(manifest.publishedAt).toBe(reservedPublishedAt.toISOString())
    expect(manifest.epoch.id).toBe(fakeEpoch.id)
    expect(manifest.files).toHaveLength(9)

    expect(repositoryMocks.markDumpRunPublished).toHaveBeenCalledWith(
      expect.anything(),
      fakePendingRun.id,
    )
  })

  test('refuses to publish the current JST month without connecting to the database', async () => {
    const pool = createFakePool()
    const objectStore = new InMemoryObjectStore()
    const stillOpen = new Date(bounds.upperBoundUtc.getTime() - 1000)
    vi.spyOn(Date, 'now').mockReturnValue(stillOpen.getTime())

    await expect(publishDumpMonth(pool, objectStore, dumpMonth)).rejects.toThrow(/close|open/i)
    expect(pool.connect).not.toHaveBeenCalled()
  })

  test('refuses to publish a future JST month without connecting to the database', async () => {
    const pool = createFakePool()
    const objectStore = new InMemoryObjectStore()
    const beforeMonthStarts = new Date(bounds.lowerBoundUtc.getTime() - 1000)
    vi.spyOn(Date, 'now').mockReturnValue(beforeMonthStarts.getTime())

    await expect(publishDumpMonth(pool, objectStore, dumpMonth)).rejects.toThrow()
    expect(pool.connect).not.toHaveBeenCalled()
  })

  test('is idempotent: a run already published short-circuits without re-exporting', async () => {
    repositoryMocks.findOrCreateDumpRun.mockResolvedValue(fakePublishedRun)
    const pool = createFakePool()
    const objectStore = new InMemoryObjectStore()

    const result = await publishDumpMonth(pool, objectStore, dumpMonth)

    expect(result.status).toBe('published')
    expect(exportMocks.exportDumpMonthPartitions).not.toHaveBeenCalled()
    expect(repositoryMocks.recordDumpFileExport).not.toHaveBeenCalled()
  })

  test('retries a previously failed run through the full pipeline again', async () => {
    repositoryMocks.findOrCreateDumpRun.mockResolvedValue({
      ...fakePendingRun,
      status: 'failed',
      error: 'previous attempt crashed',
    })
    const pool = createFakePool()
    const objectStore = new InMemoryObjectStore()

    const result = await publishDumpMonth(pool, objectStore, dumpMonth)

    expect(result.status).toBe('published')
    expect(exportMocks.exportDumpMonthPartitions).toHaveBeenCalledTimes(1)
  })

  test('marks the run failed with an actionable message and rethrows when export fails', async () => {
    exportMocks.exportDumpMonthPartitions.mockRejectedValue(new Error('default partition has rows'))
    const pool = createFakePool()
    const objectStore = new InMemoryObjectStore()

    await expect(publishDumpMonth(pool, objectStore, dumpMonth)).rejects.toThrow(
      'default partition has rows',
    )
    expect(repositoryMocks.setDumpRunStatus).toHaveBeenCalledWith(
      expect.anything(),
      fakePendingRun.id,
      'failed',
      expect.stringContaining('default partition has rows'),
    )
    expect(repositoryMocks.markDumpRunPublished).not.toHaveBeenCalled()
  })

  test('marks the run failed and never commits when the manifest fails read-back verification', async () => {
    const pool = createFakePool()
    const objectStore = new InMemoryObjectStore()
    const manifestObjectKey = deriveCommunityDumpManifestObjectKey(fakeEpoch.id, dumpMonth)
    await objectStore.putIfAbsent(manifestObjectKey, Buffer.from('not the manifest we will build'))

    await expect(publishDumpMonth(pool, objectStore, dumpMonth)).rejects.toThrow(
      ObjectVerificationError,
    )
    expect(repositoryMocks.setDumpRunStatus).toHaveBeenCalledWith(
      expect.anything(),
      fakePendingRun.id,
      'failed',
      expect.any(String),
    )
    expect(repositoryMocks.markDumpRunPublished).not.toHaveBeenCalled()
  })

  test('marks the run failed and never reaches the manifest phase when a data object fails read-back verification', async () => {
    const pool = createFakePool()
    const objectStore = new InMemoryObjectStore()
    const mismatchedDataset = communityDumpDatasets[0].dataset
    const dataObjectKey = deriveCommunityDumpDataObjectKey(
      fakeEpoch.id,
      dumpMonth,
      mismatchedDataset,
    )
    await objectStore.putIfAbsent(dataObjectKey, Buffer.from('not the export we will produce'))

    await expect(publishDumpMonth(pool, objectStore, dumpMonth)).rejects.toThrow(
      ObjectVerificationError,
    )
    expect(repositoryMocks.recordManifestMetadata).not.toHaveBeenCalled()
    expect(repositoryMocks.markDumpRunPublished).not.toHaveBeenCalled()
  })
})
