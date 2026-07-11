import { describe, expect, test } from 'vitest'

import { CommunityDumpError } from '../src/dumps/community-dump-errors'
import { communityDumpDatasetNames } from '../src/dumps/community-dump-registry'
import {
  communityDumpManifestSchemaVersion,
  communityDumpManifestTimezone,
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
