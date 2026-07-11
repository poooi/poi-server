import { describe, expect, test } from 'vitest'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { readFileSync } from 'fs'
import path from 'path'

import * as schema from '../src/db/postgres/schema'

const expectedTables = [
  'schema_metadata',
  'data_dump_runs',
  'data_dump_files',
  'create_ship_records',
  'create_item_records',
  'remodel_item_records',
  'drop_ship_records',
  'pass_event_records',
  'battle_apis',
  'night_contacts',
  'aaci_records',
  'night_battle_cis',
  'select_rank_records',
  'recipe_records',
  'ship_stats',
  'enemy_infos',
  'quests',
  'quest_rewards',
  'item_improvement_availability_facts',
  'item_improvement_cost_facts',
  'item_improvement_update_facts',
] as const

describe('PostgreSQL schema contract', () => {
  test('declares every control, Observation, stateful, and Fact table', () => {
    const tableNames = Object.values(schema).flatMap((value) =>
      value != null && typeof value === 'object' && Symbol.for('drizzle:IsDrizzleTable') in value
        ? [getTableConfig(value as Parameters<typeof getTableConfig>[0]).name]
        : [],
    )

    expect(tableNames.sort()).toEqual([...expectedTables].sort())
  })

  test.each([
    ['create_ship_records', ['id', 'ingested_at', 'items', 'kdock_id', 'origin']],
    ['drop_ship_records', ['id', 'ingested_at', 'owned_ship_snapshot', 'enemy_ships1', 'origin']],
    ['enemy_infos', ['identity_hash', 'stats1', 'equips2', 'bombers_min', 'count']],
    ['quest_rewards', ['key', 'selections', 'bonus', 'bonus_count']],
    [
      'item_improvement_cost_facts',
      ['export_id', 'first_client_observed_at', 'req_slot_items', 'origins', 'count'],
    ],
  ])('declares exact representative columns for %s', (tableName, expectedColumns) => {
    const table = Object.values(schema).find(
      (value) =>
        value != null &&
        typeof value === 'object' &&
        Symbol.for('drizzle:IsDrizzleTable') in value &&
        getTableConfig(value as Parameters<typeof getTableConfig>[0]).name === tableName,
    )
    expect(table).toBeDefined()
    const columnNames = getTableConfig(table as Parameters<typeof getTableConfig>[0]).columns.map(
      (column) => column.name,
    )
    expect(columnNames).toEqual(expect.arrayContaining(expectedColumns))
  })

  test('uses one shared sequence for monotonic cross-Fact export IDs', () => {
    expect(schema.itemImprovementFactIdSequence.seqName).toBe('item_improvement_fact_id_seq')
  })

  test('migration creates all Observation parents and default safety-net partitions', () => {
    const migration = readFileSync(
      path.resolve(__dirname, '../drizzle/0000_initial_postgresql_schema.sql'),
      'utf8',
    )

    expect(migration.match(/PARTITION BY RANGE \("ingested_at"\)/g)).toHaveLength(9)
    expect(migration.match(/PARTITION OF ".+?" DEFAULT/g)).toHaveLength(9)
    expect(migration).toContain(
      'INSERT INTO "schema_metadata" ("singleton", "version") VALUES (true, 1)',
    )
  })
})
