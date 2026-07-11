import { describe, expect, test } from 'vitest'

import { CommunityDumpError } from '../src/dumps/community-dump-errors'
import {
  communityDumpDataObjectSchemaVersion,
  deriveCommunityDumpDataObjectKey,
  deriveCommunityDumpManifestObjectKey,
} from '../src/dumps/community-dump-object-keys'
import { communityDumpDatasetNames } from '../src/dumps/community-dump-registry'

/**
 * Deterministic Community Dump v1 object key derivation
 * (docs/postgresql-migration-plan.md lines 646-651):
 *   epochs/{epochId}/months/{YYYY-MM}/v{schemaVersion}/{dataset}.jsonl.zst
 *   epochs/{epochId}/months/{YYYY-MM}/v{schemaVersion}/manifest.json
 */

const epochId = '11111111-1111-1111-1111-111111111111'

describe('deriveCommunityDumpDataObjectKey', () => {
  test('builds the exact key layout for every one of the nine datasets', () => {
    for (const dataset of communityDumpDatasetNames) {
      expect(deriveCommunityDumpDataObjectKey(epochId, '2024-01', dataset)).toBe(
        `epochs/${epochId}/months/2024-01/v1/${dataset}.jsonl.zst`,
      )
    }
  })

  test('schema version constant is 1 and is embedded as "v1"', () => {
    expect(communityDumpDataObjectSchemaVersion).toBe(1)
  })

  test.each([
    ['missing leading zero month', '2024-1'],
    ['month 00', '2024-00'],
    ['month 13', '2024-13'],
    ['wrong separator', '2024/01'],
    ['year too short', '24-01'],
    ['empty string', ''],
  ])('rejects an invalid dumpMonth (%s)', (_label, dumpMonth) => {
    expect(() =>
      deriveCommunityDumpDataObjectKey(epochId, dumpMonth, 'createShipObservations'),
    ).toThrow(CommunityDumpError)
  })

  test('rejects an empty epochId', () => {
    expect(() => deriveCommunityDumpDataObjectKey('', '2024-01', 'createShipObservations')).toThrow(
      CommunityDumpError,
    )
  })

  test('rejects an epochId that is not a UUID (refuses to embed structurally unsafe key segments)', () => {
    expect(() =>
      deriveCommunityDumpDataObjectKey('../escape-attempt', '2024-01', 'createShipObservations'),
    ).toThrow(CommunityDumpError)
    expect(() =>
      deriveCommunityDumpDataObjectKey('abcd', '2024-01', 'createShipObservations'),
    ).toThrow(CommunityDumpError)
  })
})

describe('deriveCommunityDumpManifestObjectKey', () => {
  test('builds the exact manifest key layout', () => {
    expect(deriveCommunityDumpManifestObjectKey(epochId, '2024-01')).toBe(
      `epochs/${epochId}/months/2024-01/v1/manifest.json`,
    )
  })

  test('rejects an invalid dumpMonth', () => {
    expect(() => deriveCommunityDumpManifestObjectKey(epochId, 'not-a-month')).toThrow(
      CommunityDumpError,
    )
  })

  test('rejects an empty epochId', () => {
    expect(() => deriveCommunityDumpManifestObjectKey('', '2024-01')).toThrow(CommunityDumpError)
  })

  test('never mixes up with the data object key layout: they only differ in the trailing segment', () => {
    const manifestKey = deriveCommunityDumpManifestObjectKey(epochId, '2024-01')
    const dataKey = deriveCommunityDumpDataObjectKey(epochId, '2024-01', 'createShipObservations')
    const manifestPrefix = manifestKey.replace(/manifest\.json$/, '')
    expect(dataKey.startsWith(manifestPrefix)).toBe(true)
  })
})
