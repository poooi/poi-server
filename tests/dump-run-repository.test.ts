import { describe, expect, test, vi } from 'vitest'

import { CommunityDumpError } from '../src/dumps/community-dump-errors'
import {
  type PartitionQueryClient,
  type PartitionQueryResult,
} from '../src/db/postgres/partitions/adapter'
import { parseDumpMonth } from '../src/db/postgres/partitions/dump-month'
import {
  CommunityDumpVerificationMismatchError,
  CommunityDumpWorkflowError,
} from '../src/db/postgres/dumps/errors'
import {
  findOrCreateDumpRun,
  listDumpFilesByRunId,
  listDumpFilesByRunIdForUpdate,
  loadDatabaseNow,
  loadDumpRunById,
  loadDumpRunByIdForUpdate,
  markDumpFileVerified,
  markDumpRunCleaned,
  markDumpRunPublished,
  recordDumpFileExport,
  recordManifestMetadata,
  reservePublicationTimestamp,
  setDumpRunStatus,
  type DumpFileRow,
  type DumpRunRow,
} from '../src/db/postgres/dumps/dump-run-repository'

const emptyResult: PartitionQueryResult = { rows: [], rowCount: 0 }

const createFakeClient = (
  impl: (text: string, values?: readonly unknown[]) => Promise<PartitionQueryResult>,
): PartitionQueryClient => ({
  query: vi.fn(impl),
})

const runRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: '7',
  epoch_id: '11111111-1111-1111-1111-111111111111',
  dump_month: '2024-01',
  schema_version: 1,
  status: 'pending',
  manifest_object_key: null,
  manifest_bytes: null,
  manifest_sha256: null,
  published_at: null,
  cleanup_eligible_at: null,
  cleaned_at: null,
  error: null,
  ...overrides,
})

const expectedRunRow = (overrides: Partial<DumpRunRow> = {}): DumpRunRow => ({
  id: 7,
  epochId: '11111111-1111-1111-1111-111111111111',
  dumpMonth: '2024-01',
  schemaVersion: 1,
  status: 'pending',
  manifestObjectKey: null,
  manifestBytes: null,
  manifestSha256: null,
  publishedAt: null,
  cleanupEligibleAt: null,
  cleanedAt: null,
  error: null,
  ...overrides,
})

const fileRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: '3',
  dump_run_id: '7',
  dataset: 'createShipObservations',
  partition_name: 'create_ship_records_2024_01',
  object_key: 'epochs/e/months/2024-01/v1/createShipObservations.jsonl.zst',
  row_count: '12345',
  compressed_bytes: '987654',
  sha256: Buffer.from('a'.repeat(64), 'hex'),
  verified_at: null,
  ...overrides,
})

const expectedFileRow = (overrides: Partial<DumpFileRow> = {}): DumpFileRow => ({
  id: 3,
  dumpRunId: 7,
  dataset: 'createShipObservations',
  partitionName: 'create_ship_records_2024_01',
  objectKey: 'epochs/e/months/2024-01/v1/createShipObservations.jsonl.zst',
  rowCount: 12345,
  compressedBytes: 987654,
  sha256: 'a'.repeat(64),
  verifiedAt: null,
  ...overrides,
})

/**
 * `data_dump_runs`/`data_dump_files` repository seam (docs/postgresql-migration-plan.md lines
 * 736-739, 746-747, 750-752, 761-764). Every test here supplies a plain fake `PartitionQueryClient`
 * (the exact same port `partitions/catalog.ts` uses) and asserts the exact SQL/params issued plus
 * the mapped TypeScript row, following tests/partition-catalog.test.ts's style. BIGINT columns
 * (`id`, `dump_run_id`, `manifest_bytes`, `row_count`, `compressed_bytes`) are simulated as decimal
 * strings, matching real node-postgres wire behavior with no custom type parser registered.
 */
describe('findOrCreateDumpRun', () => {
  test('issues an upsert-by-natural-key insert and maps the returned row', async () => {
    const client = createFakeClient(async () => ({ rows: [runRow()], rowCount: 1 }))

    const result = await findOrCreateDumpRun(client, {
      epochId: '11111111-1111-1111-1111-111111111111',
      dumpMonth: parseDumpMonth('2024-01'),
      schemaVersion: 1,
    })

    expect(client.query).toHaveBeenCalledTimes(1)
    const [sql, values] = vi.mocked(client.query).mock.calls[0]
    expect(sql).toContain('insert into data_dump_runs')
    expect(sql).toContain('on conflict')
    expect(sql.toLowerCase()).toContain('do update')
    expect(values).toEqual(['11111111-1111-1111-1111-111111111111', '2024-01-01', 1])
    expect(result).toEqual(expectedRunRow())
  })

  test('resuming returns the pre-existing row exactly as stored, not a reset one', async () => {
    const client = createFakeClient(async () => ({
      rows: [runRow({ status: 'exporting', error: 'previous attempt failed mid-export' })],
      rowCount: 1,
    }))

    const result = await findOrCreateDumpRun(client, {
      epochId: '11111111-1111-1111-1111-111111111111',
      dumpMonth: parseDumpMonth('2024-01'),
      schemaVersion: 1,
    })

    expect(result).toEqual(
      expectedRunRow({ status: 'exporting', error: 'previous attempt failed mid-export' }),
    )
  })

  test('throws when the database returns no row at all', async () => {
    const client = createFakeClient(async () => emptyResult)

    await expect(
      findOrCreateDumpRun(client, {
        epochId: '11111111-1111-1111-1111-111111111111',
        dumpMonth: parseDumpMonth('2024-01'),
        schemaVersion: 1,
      }),
    ).rejects.toThrow(CommunityDumpWorkflowError)
  })
})

describe('loadDumpRunById', () => {
  test('returns the mapped row when found', async () => {
    const client = createFakeClient(async () => ({ rows: [runRow()], rowCount: 1 }))

    const result = await loadDumpRunById(client, 7)

    const [sql, values] = vi.mocked(client.query).mock.calls[0]
    expect(sql).toContain('select')
    expect(sql).toContain('from data_dump_runs')
    expect(values).toEqual([7])
    expect(result).toEqual(expectedRunRow())
  })

  test('returns null when no row matches the id', async () => {
    const client = createFakeClient(async () => emptyResult)

    const result = await loadDumpRunById(client, 999)

    expect(result).toBeNull()
  })
})

/**
 * `loadDumpRunByIdForUpdate`/`listDumpFilesByRunIdForUpdate` exist solely for the cleanup
 * workflow's final destructive transaction (docs/postgresql-migration-plan.md lines 759, 762-764:
 * "verify that run's epoch, Dump Month, schema version, manifest object key, manifest digest, and
 * published/eligible state" immediately before detaching/dropping partitions). Row-level locking
 * via `for update` is the whole point — proven here by asserting the exact SQL suffix — so a
 * concurrent writer cannot change the row out from under the destructive transaction between its
 * re-check and its `markDumpRunCleaned` commit.
 */
describe('loadDumpRunByIdForUpdate', () => {
  test('issues the same select as loadDumpRunById but with a trailing "for update"', async () => {
    const client = createFakeClient(async () => ({ rows: [runRow()], rowCount: 1 }))

    const result = await loadDumpRunByIdForUpdate(client, 7)

    const [sql, values] = vi.mocked(client.query).mock.calls[0]
    expect(sql.trim().toLowerCase()).toContain('from data_dump_runs where id = $1')
    expect(sql.trim().toLowerCase().endsWith('for update')).toBe(true)
    expect(values).toEqual([7])
    expect(result).toEqual(expectedRunRow())
  })

  test('returns null when no row matches the id', async () => {
    const client = createFakeClient(async () => emptyResult)

    const result = await loadDumpRunByIdForUpdate(client, 999)

    expect(result).toBeNull()
  })
})

describe('listDumpFilesByRunIdForUpdate', () => {
  test('issues the same select as listDumpFilesByRunId but with a trailing "for update"', async () => {
    const client = createFakeClient(async () => ({ rows: [fileRow()], rowCount: 1 }))

    const result = await listDumpFilesByRunIdForUpdate(client, 7)

    const [sql, values] = vi.mocked(client.query).mock.calls[0]
    expect(sql.trim().toLowerCase()).toContain('from data_dump_files where dump_run_id = $1')
    expect(sql.trim().toLowerCase().endsWith('for update')).toBe(true)
    expect(values).toEqual([7])
    expect(result).toEqual([expectedFileRow()])
  })

  test('returns an empty array when the run has no recorded files', async () => {
    const client = createFakeClient(async () => emptyResult)

    const result = await listDumpFilesByRunIdForUpdate(client, 7)

    expect(result).toEqual([])
  })
})

/**
 * `loadDatabaseNow` backs the cleanup workflow's grace-period eligibility check, which the
 * migration plan ties specifically to the database server's own clock, never this process's
 * clock (docs/postgresql-migration-plan.md lines 754: "After the grace period..."; contrast with
 * `publish-dump-month.ts`'s deliberate use of `Date.now()` for the Dump Month closed-check).
 */
describe('loadDatabaseNow', () => {
  test('reads clock_timestamp() and returns it as a Date', async () => {
    const now = new Date('2024-02-20T12:00:00.000Z')
    const client = createFakeClient(async () => ({ rows: [{ now }], rowCount: 1 }))

    const result = await loadDatabaseNow(client)

    const [sql] = vi.mocked(client.query).mock.calls[0]
    expect(sql).toContain('clock_timestamp()')
    expect(result).toEqual(now)
  })

  test('throws when clock_timestamp() unexpectedly returns no row', async () => {
    const client = createFakeClient(async () => emptyResult)

    await expect(loadDatabaseNow(client)).rejects.toThrow(CommunityDumpWorkflowError)
  })
})

describe('setDumpRunStatus', () => {
  test('updates status and clears error on a successful transition', async () => {
    const client = createFakeClient(async () => ({
      rows: [runRow({ status: 'exporting' })],
      rowCount: 1,
    }))

    const result = await setDumpRunStatus(client, 7, 'exporting', null)

    const [sql, values] = vi.mocked(client.query).mock.calls[0]
    expect(sql).toContain('update data_dump_runs')
    expect(sql).toContain('set')
    expect(values).toEqual([7, 'exporting', null])
    expect(result).toEqual(expectedRunRow({ status: 'exporting' }))
  })

  test('records an actionable error message on a failed transition', async () => {
    const client = createFakeClient(async () => ({
      rows: [runRow({ status: 'failed', error: 'export failed: connection reset' })],
      rowCount: 1,
    }))

    const result = await setDumpRunStatus(client, 7, 'failed', 'export failed: connection reset')

    const [, values] = vi.mocked(client.query).mock.calls[0]
    expect(values).toEqual([7, 'failed', 'export failed: connection reset'])
    expect(result.status).toBe('failed')
    expect(result.error).toBe('export failed: connection reset')
  })

  test('throws when the referenced run id does not exist', async () => {
    const client = createFakeClient(async () => emptyResult)

    await expect(setDumpRunStatus(client, 999, 'exporting', null)).rejects.toThrow(
      CommunityDumpWorkflowError,
    )
  })
})

describe('reservePublicationTimestamp', () => {
  test('persists a stable publication timestamp using coalesce, so retries reuse it', async () => {
    const publishedAt = new Date('2024-02-01T00:00:00.000Z')
    const client = createFakeClient(async () => ({
      rows: [{ published_at: publishedAt }],
      rowCount: 1,
    }))

    const result = await reservePublicationTimestamp(client, 7)

    const [sql, values] = vi.mocked(client.query).mock.calls[0]
    expect(sql).toContain('coalesce')
    expect(sql).toContain('published_at')
    expect(values).toEqual([7])
    expect(result).toEqual(publishedAt)
  })

  test('throws when the referenced run id does not exist', async () => {
    const client = createFakeClient(async () => emptyResult)

    await expect(reservePublicationTimestamp(client, 999)).rejects.toThrow(
      CommunityDumpWorkflowError,
    )
  })
})

describe('recordManifestMetadata', () => {
  test('persists the manifest object key, byte count, and SHA-256 as bytea', async () => {
    const sha256Hex = 'b'.repeat(64)
    const client = createFakeClient(async () => ({
      rows: [
        runRow({
          status: 'uploaded',
          manifest_object_key: 'epochs/e/months/2024-01/v1/manifest.json',
          manifest_bytes: '4096',
          manifest_sha256: Buffer.from(sha256Hex, 'hex'),
        }),
      ],
      rowCount: 1,
    }))

    const result = await recordManifestMetadata(client, 7, {
      objectKey: 'epochs/e/months/2024-01/v1/manifest.json',
      bytes: 4096,
      sha256Hex,
    })

    const [sql, values] = vi.mocked(client.query).mock.calls[0]
    expect(sql).toContain('update data_dump_runs')
    expect(sql).toContain('manifest_object_key')
    expect(sql).toContain('manifest_bytes')
    expect(sql).toContain('manifest_sha256')
    expect(values?.[0]).toBe(7)
    expect(values?.[1]).toBe('epochs/e/months/2024-01/v1/manifest.json')
    expect(values?.[2]).toBe(4096)
    expect(Buffer.isBuffer(values?.[3])).toBe(true)
    expect((values?.[3] as Buffer).toString('hex')).toBe(sha256Hex)
    expect(result).toEqual(
      expectedRunRow({
        status: 'uploaded',
        manifestObjectKey: 'epochs/e/months/2024-01/v1/manifest.json',
        manifestBytes: 4096,
        manifestSha256: sha256Hex,
      }),
    )
  })
})

describe('markDumpRunPublished', () => {
  test('sets status to published and derives cleanup_eligible_at from the persisted published_at', async () => {
    const publishedAt = new Date('2024-02-01T00:00:00.000Z')
    const cleanupEligibleAt = new Date('2024-02-08T00:00:00.000Z')
    const client = createFakeClient(async () => ({
      rows: [
        runRow({
          status: 'published',
          published_at: publishedAt,
          cleanup_eligible_at: cleanupEligibleAt,
        }),
      ],
      rowCount: 1,
    }))

    const result = await markDumpRunPublished(client, 7)

    const [sql, values] = vi.mocked(client.query).mock.calls[0]
    expect(sql).toContain("status = 'published'")
    expect(sql).toContain("interval '7 days'")
    expect(values).toEqual([7])
    expect(result).toEqual(expectedRunRow({ status: 'published', publishedAt, cleanupEligibleAt }))
  })
})

describe('markDumpRunCleaned', () => {
  test('sets status to cleaned and records cleaned_at', async () => {
    const cleanedAt = new Date('2024-02-08T01:00:00.000Z')
    const client = createFakeClient(async () => ({
      rows: [runRow({ status: 'cleaned', cleaned_at: cleanedAt })],
      rowCount: 1,
    }))

    const result = await markDumpRunCleaned(client, 7)

    const [sql, values] = vi.mocked(client.query).mock.calls[0]
    expect(sql).toContain("status = 'cleaned'")
    expect(values).toEqual([7])
    expect(result).toEqual(expectedRunRow({ status: 'cleaned', cleanedAt }))
  })
})

describe('recordDumpFileExport', () => {
  test('inserts a fresh row when none exists yet for this dataset', async () => {
    const calls: Array<{ text: string; values?: readonly unknown[] }> = []
    const client = createFakeClient(async (text, values) => {
      calls.push({ text, values })
      if (text.trim().startsWith('select')) {
        return emptyResult
      }
      return { rows: [fileRow()], rowCount: 1 }
    })

    const result = await recordDumpFileExport(client, {
      dumpRunId: 7,
      dataset: 'createShipObservations',
      partitionName: 'create_ship_records_2024_01',
      objectKey: 'epochs/e/months/2024-01/v1/createShipObservations.jsonl.zst',
      rowCount: 12345,
      compressedBytes: 987654,
      sha256Hex: 'a'.repeat(64),
    })

    expect(calls).toHaveLength(2)
    expect(calls[0].text).toContain('select')
    expect(calls[0].text).toContain('from data_dump_files')
    expect(calls[1].text).toContain('insert into data_dump_files')
    expect(calls[1].text).toContain('on conflict')
    expect(result).toEqual(expectedFileRow())
  })

  test('overwrites an existing not-yet-verified row (resuming a crashed export)', async () => {
    const calls: string[] = []
    const client = createFakeClient(async (text) => {
      calls.push(text.trim())
      if (text.trim().startsWith('select')) {
        return {
          rows: [fileRow({ row_count: '1', compressed_bytes: '1', verified_at: null })],
          rowCount: 1,
        }
      }
      return { rows: [fileRow()], rowCount: 1 }
    })

    const result = await recordDumpFileExport(client, {
      dumpRunId: 7,
      dataset: 'createShipObservations',
      partitionName: 'create_ship_records_2024_01',
      objectKey: 'epochs/e/months/2024-01/v1/createShipObservations.jsonl.zst',
      rowCount: 12345,
      compressedBytes: 987654,
      sha256Hex: 'a'.repeat(64),
    })

    expect(calls[1]).toContain('insert into data_dump_files')
    expect(result).toEqual(expectedFileRow())
  })

  test('short-circuits without writing when an already-verified row exactly matches', async () => {
    const client = createFakeClient(async (text) => {
      if (text.trim().startsWith('select')) {
        return {
          rows: [fileRow({ verified_at: new Date('2024-02-01T00:00:00.000Z') })],
          rowCount: 1,
        }
      }
      throw new Error('must not attempt to write once already verified and matching')
    })

    const result = await recordDumpFileExport(client, {
      dumpRunId: 7,
      dataset: 'createShipObservations',
      partitionName: 'create_ship_records_2024_01',
      objectKey: 'epochs/e/months/2024-01/v1/createShipObservations.jsonl.zst',
      rowCount: 12345,
      compressedBytes: 987654,
      sha256Hex: 'a'.repeat(64),
    })

    expect(client.query).toHaveBeenCalledTimes(1)
    expect(result).toEqual(expectedFileRow({ verifiedAt: new Date('2024-02-01T00:00:00.000Z') }))
  })

  test('refuses to overwrite an already-verified row whose recorded metadata does not match', async () => {
    const client = createFakeClient(async (text) => {
      if (text.trim().startsWith('select')) {
        return {
          rows: [
            fileRow({
              row_count: '1',
              verified_at: new Date('2024-02-01T00:00:00.000Z'),
            }),
          ],
          rowCount: 1,
        }
      }
      throw new Error('must not attempt to write when an already-verified row mismatches')
    })

    await expect(
      recordDumpFileExport(client, {
        dumpRunId: 7,
        dataset: 'createShipObservations',
        partitionName: 'create_ship_records_2024_01',
        objectKey: 'epochs/e/months/2024-01/v1/createShipObservations.jsonl.zst',
        rowCount: 12345,
        compressedBytes: 987654,
        sha256Hex: 'a'.repeat(64),
      }),
    ).rejects.toThrow(CommunityDumpVerificationMismatchError)
  })
})

describe('markDumpFileVerified', () => {
  test('sets verified_at for the given run and dataset', async () => {
    const verifiedAt = new Date('2024-02-01T00:00:00.000Z')
    const client = createFakeClient(async () => ({
      rows: [fileRow({ verified_at: verifiedAt })],
      rowCount: 1,
    }))

    const result = await markDumpFileVerified(client, 7, 'createShipObservations')

    const [sql, values] = vi.mocked(client.query).mock.calls[0]
    expect(sql).toContain('update data_dump_files')
    expect(sql).toContain('verified_at')
    expect(values).toEqual([7, 'createShipObservations'])
    expect(result).toEqual(expectedFileRow({ verifiedAt }))
  })

  test('throws when no row matches the run and dataset', async () => {
    const client = createFakeClient(async () => emptyResult)

    await expect(markDumpFileVerified(client, 7, 'createShipObservations')).rejects.toThrow(
      CommunityDumpWorkflowError,
    )
  })
})

describe('listDumpFilesByRunId', () => {
  test('returns every recorded file for the run, mapped', async () => {
    const client = createFakeClient(async () => ({
      rows: [fileRow(), fileRow({ id: '4', dataset: 'createItemObservations' })],
      rowCount: 2,
    }))

    const result = await listDumpFilesByRunId(client, 7)

    const [sql, values] = vi.mocked(client.query).mock.calls[0]
    expect(sql).toContain('from data_dump_files')
    expect(values).toEqual([7])
    expect(result).toEqual([
      expectedFileRow(),
      expectedFileRow({ id: 4, dataset: 'createItemObservations' }),
    ])
  })

  test('returns an empty array when the run has no recorded files', async () => {
    const client = createFakeClient(async () => emptyResult)

    const result = await listDumpFilesByRunId(client, 7)

    expect(result).toEqual([])
  })
})

// Bigint-as-string realism: a row whose numeric columns are somehow not parseable safe integers
// must fail loudly (reusing dumps/community-dump-values.ts's own invariant), never silently
// coerce to NaN or 0.
describe('row mapping defends against corrupt numeric columns', () => {
  test('rejects a row whose id is not a valid non-negative integer', async () => {
    const client = createFakeClient(async () => ({
      rows: [runRow({ id: 'not-a-number' })],
      rowCount: 1,
    }))

    await expect(
      findOrCreateDumpRun(client, {
        epochId: '11111111-1111-1111-1111-111111111111',
        dumpMonth: parseDumpMonth('2024-01'),
        schemaVersion: 1,
      }),
    ).rejects.toThrow(CommunityDumpError)
  })
})
