import { describe, expect, test } from 'vitest'

import {
  communityDumpDatasetNames,
  communityDumpDatasets,
  getCommunityDumpDataset,
  isCommunityDumpDatasetName,
} from '../src/dumps/community-dump-registry'

// Exact dataset order, table names, and ordered camelCase keys transcribed from
// docs/postgresql-migration-plan.md lines 646-699 (object key layout) and 331-461
// (append-heavy report table names/columns).
const expectedRegistry: Array<{
  dataset: string
  table: string
  fields: Array<[sourceColumn: string, apiKey: string]>
}> = [
  {
    dataset: 'createShipObservations',
    table: 'create_ship_records',
    fields: [
      ['items', 'items'],
      ['kdock_id', 'kdockId'],
      ['secretary', 'secretary'],
      ['ship_id', 'shipId'],
      ['highspeed', 'highspeed'],
      ['teitoku_lv', 'teitokuLv'],
      ['large_flag', 'largeFlag'],
      ['origin', 'origin'],
    ],
  },
  {
    dataset: 'createItemObservations',
    table: 'create_item_records',
    fields: [
      ['items', 'items'],
      ['secretary', 'secretary'],
      ['item_id', 'itemId'],
      ['teitoku_lv', 'teitokuLv'],
      ['successful', 'successful'],
      ['origin', 'origin'],
    ],
  },
  {
    dataset: 'remodelItemObservations',
    table: 'remodel_item_records',
    fields: [
      ['successful', 'successful'],
      ['item_id', 'itemId'],
      ['item_level', 'itemLevel'],
      ['flagship_id', 'flagshipId'],
      ['flagship_level', 'flagshipLevel'],
      ['flagship_cond', 'flagshipCond'],
      ['consort_id', 'consortId'],
      ['consort_level', 'consortLevel'],
      ['consort_cond', 'consortCond'],
      ['teitoku_lv', 'teitokuLv'],
      ['certain', 'certain'],
    ],
  },
  {
    dataset: 'dropShipObservations',
    table: 'drop_ship_records',
    fields: [
      ['ship_id', 'shipId'],
      ['item_id', 'itemId'],
      ['map_id', 'mapId'],
      ['quest', 'quest'],
      ['cell_id', 'cellId'],
      ['enemy', 'enemy'],
      ['rank', 'rank'],
      ['is_boss', 'isBoss'],
      ['teitoku_lv', 'teitokuLv'],
      ['map_lv', 'mapLv'],
      ['enemy_ships1', 'enemyShips1'],
      ['enemy_ships2', 'enemyShips2'],
      ['enemy_formation', 'enemyFormation'],
      ['base_exp', 'baseExp'],
      ['teitoku_id', 'teitokuId'],
      ['owned_ship_snapshot', 'ownedShipSnapshot'],
      ['origin', 'origin'],
    ],
  },
  {
    dataset: 'passEventObservations',
    table: 'pass_event_records',
    fields: [
      ['teitoku_id', 'teitokuId'],
      ['teitoku_lv', 'teitokuLv'],
      ['map_id', 'mapId'],
      ['map_lv', 'mapLv'],
      ['rewards', 'rewards'],
      ['origin', 'origin'],
    ],
  },
  {
    dataset: 'battleApiObservations',
    table: 'battle_apis',
    fields: [
      ['origin', 'origin'],
      ['path', 'path'],
      ['data', 'data'],
    ],
  },
  {
    dataset: 'nightContactObservations',
    table: 'night_contacts',
    fields: [
      ['fleet_type', 'fleetType'],
      ['ship_id', 'shipId'],
      ['ship_lv', 'shipLv'],
      ['item_id', 'itemId'],
      ['item_lv', 'itemLv'],
      ['contact', 'contact'],
    ],
  },
  {
    dataset: 'aaciObservations',
    table: 'aaci_records',
    fields: [
      ['poi_version', 'poiVersion'],
      ['available', 'available'],
      ['triggered', 'triggered'],
      ['items', 'items'],
      ['improvement', 'improvement'],
      ['raw_luck', 'rawLuck'],
      ['raw_taiku', 'rawTaiku'],
      ['lv', 'lv'],
      ['hp_percent', 'hpPercent'],
      ['pos', 'pos'],
      ['origin', 'origin'],
    ],
  },
  {
    dataset: 'nightBattleCiObservations',
    table: 'night_battle_cis',
    fields: [
      ['ship_id', 'shipId'],
      ['ci', 'CI'],
      ['type', 'type'],
      ['lv', 'lv'],
      ['raw_luck', 'rawLuck'],
      ['pos', 'pos'],
      ['status', 'status'],
      ['items', 'items'],
      ['improvement', 'improvement'],
      ['search_light', 'searchLight'],
      ['flare', 'flare'],
      ['defense_id', 'defenseId'],
      ['defense_type_id', 'defenseTypeId'],
      ['ci_type', 'ciType'],
      ['display', 'display'],
      ['hit_type', 'hitType'],
      ['damage', 'damage'],
      ['damage_total', 'damageTotal'],
      ['time', 'time'],
      ['origin', 'origin'],
    ],
  },
]

describe('community dump registry', () => {
  test('contains exactly the nine expected datasets in plan order', () => {
    expect(communityDumpDatasetNames).toEqual(expectedRegistry.map((entry) => entry.dataset))
    expect(communityDumpDatasets).toHaveLength(9)
    expect(new Set(communityDumpDatasetNames).size).toBe(9)
  })

  test.each(expectedRegistry.map((entry) => [entry.dataset, entry] as const))(
    '%s maps to its table name and exact ordered fields',
    (dataset, entry) => {
      const definition = getCommunityDumpDataset(
        dataset as Parameters<typeof getCommunityDumpDataset>[0],
      )
      expect(definition.dataset).toBe(entry.dataset)
      expect(definition.table).toBe(entry.table)
      expect(definition.fields.map((field) => [field.sourceColumn, field.apiKey])).toEqual(
        entry.fields,
      )
    },
  )

  test('isCommunityDumpDatasetName narrows only known dataset names', () => {
    expect(isCommunityDumpDatasetName('createShipObservations')).toBe(true)
    expect(isCommunityDumpDatasetName('nightBattleCiObservations')).toBe(true)
    expect(isCommunityDumpDatasetName('unknownObservations')).toBe(false)
    expect(isCommunityDumpDatasetName('')).toBe(false)
  })

  test('getCommunityDumpDataset rejects unknown dataset names', () => {
    expect(() =>
      getCommunityDumpDataset(
        // @ts-expect-error exercising the runtime guard against an invalid dataset name
        'unknownObservations',
      ),
    ).toThrow()
  })
})
