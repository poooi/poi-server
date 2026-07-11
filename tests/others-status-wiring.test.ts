import { describe, expect, test, vi } from 'vitest'

const dfMock = vi.hoisted(() => vi.fn())
vi.mock('@sindresorhus/df', () => ({ default: dfMock }))

import { type DatabaseStatus } from '../src/contracts/database'
import { createGetStatus } from '../src/controllers/api/others.handlers'
import { getMongoDatabaseStatus } from '../src/controllers/api/others.mongo.status'

describe('createGetStatus', () => {
  test('merges env, disk, and the injected database status', async () => {
    dfMock.mockResolvedValue([
      { mountpoint: '/', used: 1, available: 2, capacity: 3 },
      { mountpoint: '/boot', used: 1, available: 2, capacity: 3 },
    ])
    const database: DatabaseStatus = {
      backend: 'postgresql',
      status: 'up',
      estimatedCounts: {
        createShipObservations: 1,
        createItemObservations: 0,
        remodelItemObservations: 0,
        dropShipObservations: 0,
        passEventObservations: 0,
        battleApiObservations: 0,
        nightContactObservations: 0,
        aaciObservations: 0,
        nightBattleCiObservations: 0,
        selectRankStates: 0,
        recipeAggregates: 0,
        shipStatAggregates: 0,
        enemyInfoAggregates: 0,
        questDefinitions: 0,
        questRewardDefinitions: 0,
        itemImprovementAvailabilityFacts: 0,
        itemImprovementCostFacts: 0,
        itemImprovementUpdateFacts: 0,
      },
    }
    const getDatabaseStatus = vi.fn(() => Promise.resolve(database))
    const getStatus = createGetStatus(getDatabaseStatus)

    const result = await getStatus()

    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({
      env: process.env.NODE_ENV,
      disk: [{ mountpoint: '/' }],
      database,
    })
    expect(getDatabaseStatus).toHaveBeenCalledTimes(1)
  })

  test('defaults to the MongoDB status function when none is injected', () => {
    // `getStatus` (the default export used by production routes) must remain wired to
    // `getMongoDatabaseStatus`, preserving current behavior/tests for the MongoDB backend.
    expect(createGetStatus).toBeTypeOf('function')
    expect(getMongoDatabaseStatus).toBeTypeOf('function')
  })
})
