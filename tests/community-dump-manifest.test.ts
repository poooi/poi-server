import { describe, expect, test } from 'vitest'

import { CommunityDumpError } from '../src/dumps/community-dump-errors'
import { communityDumpDatasetNames } from '../src/dumps/community-dump-registry'
import {
  communityDumpManifestSchemaVersion,
  communityDumpManifestTimezone,
  parseCommunityDumpManifestV1,
  serializeCommunityDumpManifestV1,
  type CommunityDumpManifestFileInput,
} from '../src/dumps/community-dump-manifest'

const sha256Hex = 'a'.repeat(64)
const sha256HexUppercase = 'A'.repeat(64)

const makeFile = (
  dataset: string,
  overrides: Partial<CommunityDumpManifestFileInput> = {},
): CommunityDumpManifestFileInput => ({
  dataset,
  objectKey: `epochs/epoch-1/months/2024-01/v1/${dataset}.jsonl.zst`,
  rowCount: 10,
  compressedBytes: 1024,
  sha256: sha256Hex,
  ...overrides,
})

// Scrambled relative to registry order, to prove the serializer reorders deterministically.
const scrambledDatasets = [...communityDumpDatasetNames].reverse()

const validInput = {
  epochId: '11111111-1111-1111-1111-111111111111',
  epochStartedAt: '2023-01-01T00:00:00.000Z',
  dumpMonth: '2024-01',
  publishedAt: '2024-02-01T00:00:00.000Z',
  files: scrambledDatasets.map((dataset) => makeFile(dataset)),
}

describe('serializeCommunityDumpManifestV1', () => {
  test('emits the exact manifest v1 contract with files reordered to registry order', () => {
    const manifest = serializeCommunityDumpManifestV1(validInput)

    expect(manifest.schemaVersion).toBe(1)
    expect(communityDumpManifestSchemaVersion).toBe(1)
    expect(manifest.timezone).toBe('Asia/Tokyo')
    expect(communityDumpManifestTimezone).toBe('Asia/Tokyo')
    expect(manifest.epoch).toEqual({
      id: '11111111-1111-1111-1111-111111111111',
      startedAt: '2023-01-01T00:00:00.000Z',
    })
    expect(manifest.dumpMonth).toBe('2024-01')
    expect(manifest.publishedAt).toBe('2024-02-01T00:00:00.000Z')
    expect(manifest.files.map((file) => file.dataset)).toEqual(communityDumpDatasetNames)
    expect(Object.keys(manifest)).toEqual([
      'schemaVersion',
      'epoch',
      'dumpMonth',
      'timezone',
      'publishedAt',
      'files',
    ])
  })

  test('normalizes rowCount, compressedBytes, and sha256 to decimal strings / lowercase hex', () => {
    const manifest = serializeCommunityDumpManifestV1({
      ...validInput,
      files: communityDumpDatasetNames.map((dataset) =>
        makeFile(dataset, {
          rowCount: dataset === 'createShipObservations' ? BigInt(9007199254740991) : 10,
          compressedBytes: dataset === 'createShipObservations' ? '2048' : 1024,
          sha256: dataset === 'createShipObservations' ? sha256HexUppercase : sha256Hex,
        }),
      ),
    })

    const createShip = manifest.files.find((file) => file.dataset === 'createShipObservations')
    expect(createShip).toEqual({
      dataset: 'createShipObservations',
      objectKey: 'epochs/epoch-1/months/2024-01/v1/createShipObservations.jsonl.zst',
      rowCount: '9007199254740991',
      compressedBytes: '2048',
      sha256: sha256Hex,
    })
    expect(Object.keys(createShip as object)).toEqual([
      'dataset',
      'objectKey',
      'rowCount',
      'compressedBytes',
      'sha256',
    ])
  })

  test('serializes a null epoch.startedAt as null', () => {
    const manifest = serializeCommunityDumpManifestV1({ ...validInput, epochStartedAt: null })
    expect(manifest.epoch.startedAt).toBeNull()
  })

  test('rejects a manifest missing one of the nine expected datasets', () => {
    const files = validInput.files.filter((file) => file.dataset !== 'aaciObservations')
    expect(() => serializeCommunityDumpManifestV1({ ...validInput, files })).toThrow(
      CommunityDumpError,
    )
  })

  test('rejects a manifest with a duplicated dataset', () => {
    const files = [...validInput.files, makeFile('aaciObservations')]
    expect(() => serializeCommunityDumpManifestV1({ ...validInput, files })).toThrow(
      CommunityDumpError,
    )
  })

  test('rejects a manifest containing an unknown dataset name', () => {
    const files = [...validInput.files.slice(0, 8), makeFile('unknownObservations')]
    expect(() => serializeCommunityDumpManifestV1({ ...validInput, files })).toThrow(
      CommunityDumpError,
    )
  })

  test.each([
    ['missing leading zero month', '2024-1'],
    ['month 00', '2024-00'],
    ['month 13', '2024-13'],
    ['wrong separator', '2024/01'],
    ['year too short', '24-01'],
    ['empty string', ''],
  ])('rejects an invalid dumpMonth (%s)', (_label, dumpMonth) => {
    expect(() => serializeCommunityDumpManifestV1({ ...validInput, dumpMonth })).toThrow(
      CommunityDumpError,
    )
  })

  test.each([
    ['non-date string', 'not-a-date'],
    ['NaN', Number.NaN],
    ['null', null],
    ['undefined', undefined],
  ])('rejects an invalid publishedAt (%s)', (_label, publishedAt) => {
    expect(() =>
      serializeCommunityDumpManifestV1({
        ...validInput,
        publishedAt,
      }),
    ).toThrow(CommunityDumpError)
  })

  test('rejects an empty epoch.id', () => {
    expect(() => serializeCommunityDumpManifestV1({ ...validInput, epochId: '' })).toThrow(
      CommunityDumpError,
    )
  })

  test.each([
    ['negative number', -1],
    ['non-integer number', 1.5],
    ['unsafe number', Number.MAX_SAFE_INTEGER + 2],
    ['negative bigint', BigInt(-1)],
    ['non-numeric string', 'abc'],
    ['negative decimal string', '-1'],
    ['leading-zero decimal string', '007'],
  ])('rejects an invalid rowCount (%s)', (_label, rowCount) => {
    const files = communityDumpDatasetNames.map((dataset) =>
      makeFile(dataset, dataset === 'createShipObservations' ? { rowCount } : {}),
    )
    expect(() => serializeCommunityDumpManifestV1({ ...validInput, files })).toThrow(
      CommunityDumpError,
    )
  })

  test.each([
    ['negative number', -1],
    ['non-integer number', 1.5],
    ['non-numeric string', 'abc'],
  ])('rejects an invalid compressedBytes (%s)', (_label, compressedBytes) => {
    const files = communityDumpDatasetNames.map((dataset) =>
      makeFile(dataset, dataset === 'createShipObservations' ? { compressedBytes } : {}),
    )
    expect(() => serializeCommunityDumpManifestV1({ ...validInput, files })).toThrow(
      CommunityDumpError,
    )
  })

  test.each([
    ['too short', 'a'.repeat(63)],
    ['too long', 'a'.repeat(65)],
    ['non-hex characters', 'g'.repeat(64)],
  ])('rejects an invalid sha256 (%s)', (_label, sha256) => {
    const files = communityDumpDatasetNames.map((dataset) =>
      makeFile(dataset, dataset === 'createShipObservations' ? { sha256 } : {}),
    )
    expect(() => serializeCommunityDumpManifestV1({ ...validInput, files })).toThrow(
      CommunityDumpError,
    )
  })

  test('accepts a 32-byte Buffer sha256 and lowercases the resulting hex', () => {
    const files = communityDumpDatasetNames.map((dataset) =>
      makeFile(
        dataset,
        dataset === 'createShipObservations' ? { sha256: Buffer.alloc(32, 0xab) } : {},
      ),
    )
    const manifest = serializeCommunityDumpManifestV1({ ...validInput, files })
    const createShip = manifest.files.find((file) => file.dataset === 'createShipObservations')
    expect(createShip?.sha256).toBe('ab'.repeat(32))
  })

  test('is deterministic for equivalent input regardless of file order', () => {
    const forward = serializeCommunityDumpManifestV1({
      ...validInput,
      files: communityDumpDatasetNames.map((dataset) => makeFile(dataset)),
    })
    const reversed = serializeCommunityDumpManifestV1({
      ...validInput,
      files: [...communityDumpDatasetNames].reverse().map((dataset) => makeFile(dataset)),
    })
    expect(JSON.stringify(forward)).toBe(JSON.stringify(reversed))
  })
})

/**
 * `parseCommunityDumpManifestV1` re-validates untrusted manifest bytes (read back from the
 * object store during cleanup's re-verification step, docs/postgresql-migration-plan.md lines
 * 754-756) by delegating structural/semantic validation back into
 * `serializeCommunityDumpManifestV1` — this module never duplicates that validator, it only
 * narrows raw JSON into the shape that validator already expects.
 */
describe('parseCommunityDumpManifestV1', () => {
  const toBuffer = (value: unknown): Buffer => Buffer.from(JSON.stringify(value), 'utf8')

  test('round-trips exactly what serializeCommunityDumpManifestV1 produced', () => {
    const manifest = serializeCommunityDumpManifestV1(validInput)
    const parsed = parseCommunityDumpManifestV1(toBuffer(manifest))
    expect(parsed).toEqual(manifest)
  })

  test('round-trips a null epoch.startedAt', () => {
    const manifest = serializeCommunityDumpManifestV1({ ...validInput, epochStartedAt: null })
    const parsed = parseCommunityDumpManifestV1(toBuffer(manifest))
    expect(parsed.epoch.startedAt).toBeNull()
  })

  test.each([
    ['missing schemaVersion', { schemaVersion: undefined }],
    ['wrong schemaVersion', { schemaVersion: 2 }],
    ['missing timezone', { timezone: undefined }],
    ['wrong timezone', { timezone: 'UTC' }],
  ])('rejects %s', (_label, override) => {
    const manifest = serializeCommunityDumpManifestV1(validInput)
    const raw: Record<string, unknown> = { ...manifest, ...override }
    if ('schemaVersion' in override && override.schemaVersion === undefined) {
      delete raw.schemaVersion
    }
    if ('timezone' in override && override.timezone === undefined) {
      delete raw.timezone
    }

    expect(() => parseCommunityDumpManifestV1(toBuffer(raw))).toThrow(CommunityDumpError)
  })

  test('rejects bytes that are not valid JSON, without throwing an uncaught SyntaxError', () => {
    expect(() => parseCommunityDumpManifestV1(Buffer.from('{not valid json', 'utf8'))).toThrow(
      CommunityDumpError,
    )
  })

  test('rejects a JSON array at the top level', () => {
    expect(() => parseCommunityDumpManifestV1(toBuffer([1, 2, 3]))).toThrow(CommunityDumpError)
  })

  test('rejects a JSON scalar at the top level', () => {
    expect(() => parseCommunityDumpManifestV1(toBuffer('just a string'))).toThrow(
      CommunityDumpError,
    )
  })

  test.each([
    ['missing epoch', { dumpMonth: '2024-01', publishedAt: '2024-02-01T00:00:00.000Z', files: [] }],
    [
      'epoch not an object',
      { epoch: 'nope', dumpMonth: '2024-01', publishedAt: '2024-02-01T00:00:00.000Z', files: [] },
    ],
    [
      'epoch missing id',
      {
        epoch: { startedAt: '2023-01-01T00:00:00.000Z' },
        dumpMonth: '2024-01',
        publishedAt: '2024-02-01T00:00:00.000Z',
        files: [],
      },
    ],
    [
      'epoch.id not a string',
      {
        epoch: { id: 42, startedAt: '2023-01-01T00:00:00.000Z' },
        dumpMonth: '2024-01',
        publishedAt: '2024-02-01T00:00:00.000Z',
        files: [],
      },
    ],
    [
      'epoch missing startedAt',
      {
        epoch: { id: '11111111-1111-1111-1111-111111111111' },
        dumpMonth: '2024-01',
        publishedAt: '2024-02-01T00:00:00.000Z',
        files: [],
      },
    ],
    [
      'missing dumpMonth',
      {
        epoch: { id: '11111111-1111-1111-1111-111111111111', startedAt: null },
        publishedAt: '2024-02-01T00:00:00.000Z',
        files: [],
      },
    ],
    [
      'dumpMonth not a string',
      {
        epoch: { id: '11111111-1111-1111-1111-111111111111', startedAt: null },
        dumpMonth: 202401,
        publishedAt: '2024-02-01T00:00:00.000Z',
        files: [],
      },
    ],
    [
      'missing publishedAt',
      {
        epoch: { id: '11111111-1111-1111-1111-111111111111', startedAt: null },
        dumpMonth: '2024-01',
        files: [],
      },
    ],
    [
      'missing files',
      {
        epoch: { id: '11111111-1111-1111-1111-111111111111', startedAt: null },
        dumpMonth: '2024-01',
        publishedAt: '2024-02-01T00:00:00.000Z',
      },
    ],
    [
      'files not an array',
      {
        epoch: { id: '11111111-1111-1111-1111-111111111111', startedAt: null },
        dumpMonth: '2024-01',
        publishedAt: '2024-02-01T00:00:00.000Z',
        files: 'nope',
      },
    ],
  ])('rejects a structurally invalid manifest (%s)', (_label, raw) => {
    expect(() => parseCommunityDumpManifestV1(toBuffer(raw))).toThrow(CommunityDumpError)
  })

  const validRawFile = {
    dataset: 'createShipObservations',
    objectKey: 'epochs/e/months/2024-01/v1/createShipObservations.jsonl.zst',
    rowCount: 10,
    compressedBytes: 1024,
    sha256: sha256Hex,
  }

  test.each([
    ['file missing dataset', { ...validRawFile, dataset: undefined }],
    ['file dataset not a string', { ...validRawFile, dataset: 42 }],
    ['file missing objectKey', { ...validRawFile, objectKey: undefined }],
    ['file objectKey not a string', { ...validRawFile, objectKey: 42 }],
    ['file missing rowCount', { ...validRawFile, rowCount: undefined }],
    ['file missing compressedBytes', { ...validRawFile, compressedBytes: undefined }],
    ['file missing sha256', { ...validRawFile, sha256: undefined }],
    ['file sha256 not a string', { ...validRawFile, sha256: 42 }],
    ['file not an object', 'not-an-object'],
  ])('rejects a structurally invalid file entry (%s)', (_label, rawFile) => {
    const raw = {
      epoch: { id: '11111111-1111-1111-1111-111111111111', startedAt: null },
      dumpMonth: '2024-01',
      publishedAt: '2024-02-01T00:00:00.000Z',
      files: communityDumpDatasetNames.map((dataset) =>
        dataset === 'createShipObservations' ? rawFile : makeFile(dataset),
      ),
    }
    expect(() => parseCommunityDumpManifestV1(toBuffer(raw))).toThrow(CommunityDumpError)
  })

  test('delegates dataset-completeness validation to serializeCommunityDumpManifestV1 (rejects a missing dataset)', () => {
    const raw = {
      epoch: { id: '11111111-1111-1111-1111-111111111111', startedAt: null },
      dumpMonth: '2024-01',
      publishedAt: '2024-02-01T00:00:00.000Z',
      files: validInput.files
        .filter((file) => file.dataset !== 'aaciObservations')
        .map((file) => ({ ...file })),
    }
    expect(() => parseCommunityDumpManifestV1(toBuffer(raw))).toThrow(CommunityDumpError)
    expect(() => parseCommunityDumpManifestV1(toBuffer(raw))).toThrow(/aaciObservations/)
  })
})
