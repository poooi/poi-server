import { describe, expect, test } from 'vitest'

import { communityDumpDatasets } from '../src/dumps/community-dump-registry'
import {
  assertObservationParentTable,
  isObservationParentTable,
  observationParentTables,
} from '../src/db/postgres/partitions/observation-tables'
import { PartitionMaintenanceError } from '../src/db/postgres/partitions/errors'

// Allowlist only the nine Observation parent/default tables from `communityDumpDatasets`
// (docs/postgresql-migration-plan.md lines 713-739). Never interpolate an unvalidated
// identifier: every table name accepted by the create-upcoming-month/repair commands must come
// from this allowlist.
describe('observationParentTables', () => {
  test('contains exactly the nine Community Dump parent table names, in registry order', () => {
    expect(observationParentTables).toEqual(
      communityDumpDatasets.map((definition) => definition.table),
    )
    expect(observationParentTables).toHaveLength(9)
  })

  test('contains only lowercase snake_case identifiers', () => {
    for (const table of observationParentTables) {
      expect(table).toMatch(/^[a-z_][a-z0-9_]*$/)
    }
  })
})

describe('isObservationParentTable', () => {
  test.each(observationParentTables)('accepts the allowlisted table %s', (table) => {
    expect(isObservationParentTable(table)).toBe(true)
  })

  test.each([
    'create_ship_records_default',
    'create_ship_records_2026_07',
    'schema_metadata',
    'data_dump_runs',
    'quests',
    'item_improvement_cost_facts',
    '',
    'create_ship_records; drop table schema_metadata;',
    'CREATE_SHIP_RECORDS',
    'create_ship_records ',
  ])('rejects the non-allowlisted identifier %s', (table) => {
    expect(isObservationParentTable(table)).toBe(false)
  })
})

describe('assertObservationParentTable', () => {
  test.each(observationParentTables)('does not throw for the allowlisted table %s', (table) => {
    expect(() => assertObservationParentTable(table)).not.toThrow()
  })

  test.each([
    'create_ship_records_default',
    'nonexistent_table',
    "create_ship_records'; drop table schema_metadata; --",
  ])('throws a PartitionMaintenanceError for %s', (table) => {
    expect(() => assertObservationParentTable(table)).toThrow(PartitionMaintenanceError)
    expect(() => assertObservationParentTable(table)).toThrow(/allowlisted/)
  })
})
