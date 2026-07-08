import { getTableColumns } from 'drizzle-orm'
import { describe, expect, test } from 'vitest'

import {
  dumpableAppendHeavyTables,
  statefulAggregateTables,
  statefulFactTables,
} from '../src/db/schema/postgres'

describe('PostgreSQL retention classification', () => {
  test('keeps dumpable append-heavy tables distinct from stateful aggregates and facts', () => {
    expect(Object.keys(dumpableAppendHeavyTables)).toEqual([
      'createShipRecords',
      'createItemRecords',
      'remodelItemRecords',
      'dropShipRecords',
      'passEventRecords',
      'battleApis',
      'nightContacts',
      'aaciRecords',
      'nightBattleCis',
    ])
    expect(Object.keys(statefulAggregateTables)).toEqual([
      'selectRankRecords',
      'recipeRecords',
      'shipStats',
      'enemyInfos',
      'quests',
      'questRewards',
    ])
    expect(Object.keys(statefulFactTables)).toEqual([
      'itemImprovementAvailabilityFacts',
      'itemImprovementCostFacts',
      'itemImprovementUpdateFacts',
    ])

    const cleanupTargets = new Set(Object.keys(dumpableAppendHeavyTables))
    for (const tableName of [
      ...Object.keys(statefulAggregateTables),
      ...Object.keys(statefulFactTables),
    ]) {
      expect(cleanupTargets.has(tableName)).toBe(false)
    }

    for (const table of Object.values(dumpableAppendHeavyTables)) {
      expect(getTableColumns(table)).toHaveProperty('ingestedAt')
      expect(getTableColumns(table)).toHaveProperty('rawPayload')
    }
  })
})
