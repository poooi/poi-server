import { describe, expect, test, vi } from 'vitest'

import { type DataEpoch } from '../src/contracts/database'
import { createPostgresDatabaseStatus } from '../src/controllers/api/others.postgres.status'

const epoch: DataEpoch = { id: 'epoch-1', startedAt: '2024-01-01T00:00:00.000Z' }

const ALL_DATASETS = [
  'createShipObservations',
  'createItemObservations',
  'remodelItemObservations',
  'dropShipObservations',
  'passEventObservations',
  'battleApiObservations',
  'nightContactObservations',
  'aaciObservations',
  'nightBattleCiObservations',
  'selectRankStates',
  'recipeAggregates',
  'shipStatAggregates',
  'enemyInfoAggregates',
  'questDefinitions',
  'questRewardDefinitions',
  'itemImprovementAvailabilityFacts',
  'itemImprovementCostFacts',
  'itemImprovementUpdateFacts',
] as const

const createFakeDb = (rows: Array<{ dataset: string; estimate: number | string }>) => ({
  execute: vi.fn(() => Promise.resolve({ rows })),
})

describe('createPostgresDatabaseStatus', () => {
  test('returns the backend-neutral shape with all 18 estimated counts and the startup epoch', async () => {
    const rows = ALL_DATASETS.map((dataset, index) => ({ dataset, estimate: index }))
    const db = createFakeDb(rows)

    const status = await createPostgresDatabaseStatus(db as never, epoch)()

    expect(status.backend).toBe('postgresql')
    expect(status.status).toBe('up')
    expect(status.epoch).toEqual(epoch)
    expect(Object.keys(status.estimatedCounts).sort()).toEqual([...ALL_DATASETS].sort())
    ALL_DATASETS.forEach((dataset, index) => {
      expect(status.estimatedCounts[dataset]).toBe(index)
    })
  })

  test('clamps a negative catalog estimate to zero', async () => {
    const rows = ALL_DATASETS.map((dataset) => ({ dataset, estimate: -5 }))
    const db = createFakeDb(rows)

    const status = await createPostgresDatabaseStatus(db as never, epoch)()

    ALL_DATASETS.forEach((dataset) => {
      expect(status.estimatedCounts[dataset]).toBe(0)
    })
  })

  test('defaults a missing dataset row to zero', async () => {
    const db = createFakeDb([{ dataset: 'createShipObservations', estimate: 3 }])

    const status = await createPostgresDatabaseStatus(db as never, epoch)()

    expect(status.estimatedCounts.createShipObservations).toBe(3)
    expect(status.estimatedCounts.enemyInfoAggregates).toBe(0)
  })

  test('accepts a string estimate (as node-postgres may return for aggregate results)', async () => {
    const db = createFakeDb([{ dataset: 'createShipObservations', estimate: '42' }])

    const status = await createPostgresDatabaseStatus(db as never, epoch)()

    expect(status.estimatedCounts.createShipObservations).toBe(42)
  })
})
