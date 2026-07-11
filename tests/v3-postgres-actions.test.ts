import { describe, expect, test, vi } from 'vitest'

import { type AppRequest } from '../src/http/request'

const createRequest = (): AppRequest => ({
  body: {},
  headers: {},
  log: { warn: vi.fn() },
  method: 'POST',
  params: {},
  path: '/api/report/v3/test',
  query: {},
  url: '/api/report/v3/test',
})

import {
  PostgresV3UnavailableError,
  postgresV3ActionsUnavailable,
} from '../src/controllers/api/report/v3.postgres.actions'

describe('postgresV3ActionsUnavailable', () => {
  test('exposes exactly the ReportV3Actions route keys', () => {
    expect(Object.keys(postgresV3ActionsUnavailable).sort()).toEqual([
      'itemImprovementRecipe',
      'itemImprovementRecipeAvailability',
      'itemImprovementRecipeCosts',
      'itemImprovementRecipeUpdates',
      'knownQuests',
      'quest',
      'questReward',
    ])
  })

  test.each([
    'itemImprovementRecipe',
    'itemImprovementRecipeAvailability',
    'itemImprovementRecipeCosts',
    'itemImprovementRecipeUpdates',
    'knownQuests',
    'quest',
    'questReward',
  ] as const)(
    '%s rejects with an actionable PostgresV3UnavailableError, never a success',
    async (name) => {
      const action = postgresV3ActionsUnavailable[name]

      await expect(action(createRequest())).rejects.toBeInstanceOf(PostgresV3UnavailableError)
      await expect(action(createRequest())).rejects.toThrow(/not implemented/i)
    },
  )
})
