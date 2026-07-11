import { describe, expect, test } from 'vitest'

import { CommunityDumpError } from '../src/dumps/community-dump-errors'
import {
  deriveCommunityDumpDataObjectKey,
  deriveCommunityDumpManifestObjectKey,
} from '../src/dumps/community-dump-object-keys'
import { communityDumpDatasetNames } from '../src/dumps/community-dump-registry'

/**
 * Deterministic Community Dump object key derivation
 * (docs/postgresql-migration-plan.md lines 646-651):
 *   {YYYY-MM}/{dataset}.jsonl.zst
 *   {YYYY-MM}/manifest.json
 */

describe('deriveCommunityDumpDataObjectKey', () => {
  test('builds the exact key layout for every registered dataset', () => {
    for (const dataset of communityDumpDatasetNames) {
      expect(deriveCommunityDumpDataObjectKey('2024-01', dataset)).toBe(
        `2024-01/${dataset}.jsonl.zst`,
      )
    }
  })

  test.each([
    ['missing leading zero month', '2024-1'],
    ['month 00', '2024-00'],
    ['month 13', '2024-13'],
    ['wrong separator', '2024/01'],
    ['year too short', '24-01'],
    ['empty string', ''],
  ])('rejects an invalid dumpMonth (%s)', (_label, dumpMonth) => {
    expect(() => deriveCommunityDumpDataObjectKey(dumpMonth, 'createShipObservations')).toThrow(
      CommunityDumpError,
    )
  })
})

describe('deriveCommunityDumpManifestObjectKey', () => {
  test('builds the exact manifest key layout', () => {
    expect(deriveCommunityDumpManifestObjectKey('2024-01')).toBe(`2024-01/manifest.json`)
  })

  test('rejects an invalid dumpMonth', () => {
    expect(() => deriveCommunityDumpManifestObjectKey('not-a-month')).toThrow(CommunityDumpError)
  })

  test('never mixes up with the data object key layout: they only differ in the trailing segment', () => {
    const manifestKey = deriveCommunityDumpManifestObjectKey('2024-01')
    const dataKey = deriveCommunityDumpDataObjectKey('2024-01', 'createShipObservations')
    const manifestPrefix = manifestKey.replace(/manifest\.json$/, '')
    expect(dataKey.startsWith(manifestPrefix)).toBe(true)
  })
})
