import { type CommunityDumpDatasetName } from './community-dump-dataset-name'
import { CommunityDumpError } from './community-dump-errors'

/**
 * Community Dump v1 registry. Transcribes docs/postgresql-migration-plan.md lines 331-341
 * (append-heavy report table names), 646-699 (object key layout table), and 701-708
 * (serialization rules) into a single backend-neutral source of truth: every dataset's
 * PostgreSQL table name and its ordered list of `(sourceColumn, apiKey)` pairs, where
 * `sourceColumn` is the exact snake_case PostgreSQL column name and `apiKey` is the exact
 * camelCase (or, for `night_battle_cis.ci`, uppercase `CI`) Community Dump JSON key.
 *
 * `observationId` and `ingestedAt` are not listed here: every dataset emits them first,
 * derived from the shared `id`/`ingested_at` columns every Observation table has (plan
 * lines 440-449), so they are handled once by the serializer instead of being repeated in
 * every dataset's field list.
 */

export interface CommunityDumpFieldDefinition {
  readonly sourceColumn: string
  readonly apiKey: string
  readonly encoding?: 'safeInteger'
}

export interface CommunityDumpDatasetDefinition {
  readonly dataset: CommunityDumpDatasetName
  readonly table: string
  readonly fields: readonly CommunityDumpFieldDefinition[]
}

const field = (
  sourceColumn: string,
  apiKey: string,
  encoding?: CommunityDumpFieldDefinition['encoding'],
): CommunityDumpFieldDefinition => ({
  sourceColumn,
  apiKey,
  encoding,
})

export const communityDumpDatasets: readonly CommunityDumpDatasetDefinition[] = [
  {
    dataset: 'createShipObservations',
    table: 'create_ship_records',
    fields: [
      field('items', 'items'),
      field('kdock_id', 'kdockId'),
      field('secretary', 'secretary'),
      field('ship_id', 'shipId'),
      field('highspeed', 'highspeed'),
      field('teitoku_lv', 'teitokuLv'),
      field('large_flag', 'largeFlag'),
      field('origin', 'origin'),
    ],
  },
  {
    dataset: 'createItemObservations',
    table: 'create_item_records',
    fields: [
      field('items', 'items'),
      field('secretary', 'secretary'),
      field('item_id', 'itemId'),
      field('teitoku_lv', 'teitokuLv'),
      field('successful', 'successful'),
      field('origin', 'origin'),
    ],
  },
  {
    dataset: 'remodelItemObservations',
    table: 'remodel_item_records',
    fields: [
      field('successful', 'successful'),
      field('item_id', 'itemId'),
      field('item_level', 'itemLevel'),
      field('flagship_id', 'flagshipId'),
      field('flagship_level', 'flagshipLevel'),
      field('flagship_cond', 'flagshipCond'),
      field('consort_id', 'consortId'),
      field('consort_level', 'consortLevel'),
      field('consort_cond', 'consortCond'),
      field('teitoku_lv', 'teitokuLv'),
      field('certain', 'certain'),
    ],
  },
  {
    dataset: 'dropShipObservations',
    table: 'drop_ship_records',
    fields: [
      field('ship_id', 'shipId'),
      field('item_id', 'itemId'),
      field('map_id', 'mapId'),
      field('quest', 'quest'),
      field('cell_id', 'cellId'),
      field('enemy', 'enemy'),
      field('rank', 'rank'),
      field('is_boss', 'isBoss'),
      field('teitoku_lv', 'teitokuLv'),
      field('map_lv', 'mapLv'),
      field('enemy_ships1', 'enemyShips1'),
      field('enemy_ships2', 'enemyShips2'),
      field('enemy_formation', 'enemyFormation'),
      field('base_exp', 'baseExp'),
      field('teitoku_id', 'teitokuId'),
      field('owned_ship_snapshot', 'ownedShipSnapshot'),
      field('origin', 'origin'),
    ],
  },
  {
    dataset: 'passEventObservations',
    table: 'pass_event_records',
    fields: [
      field('teitoku_id', 'teitokuId'),
      field('teitoku_lv', 'teitokuLv'),
      field('map_id', 'mapId'),
      field('map_lv', 'mapLv'),
      field('rewards', 'rewards'),
      field('origin', 'origin'),
    ],
  },
  {
    dataset: 'battleApiObservations',
    table: 'battle_apis',
    fields: [field('origin', 'origin'), field('path', 'path'), field('data', 'data')],
  },
  {
    dataset: 'nightContactObservations',
    table: 'night_contacts',
    fields: [
      field('fleet_type', 'fleetType'),
      field('ship_id', 'shipId'),
      field('ship_lv', 'shipLv'),
      field('item_id', 'itemId'),
      field('item_lv', 'itemLv'),
      field('contact', 'contact'),
    ],
  },
  {
    dataset: 'aaciObservations',
    table: 'aaci_records',
    fields: [
      field('poi_version', 'poiVersion'),
      field('available', 'available'),
      field('triggered', 'triggered'),
      field('items', 'items'),
      field('improvement', 'improvement'),
      field('raw_luck', 'rawLuck'),
      field('raw_taiku', 'rawTaiku'),
      field('lv', 'lv'),
      field('hp_percent', 'hpPercent'),
      field('pos', 'pos'),
      field('origin', 'origin'),
    ],
  },
  {
    dataset: 'nightBattleCiObservations',
    table: 'night_battle_cis',
    fields: [
      field('ship_id', 'shipId'),
      field('ci', 'CI'),
      field('type', 'type'),
      field('lv', 'lv'),
      field('raw_luck', 'rawLuck'),
      field('pos', 'pos'),
      field('status', 'status'),
      field('items', 'items'),
      field('improvement', 'improvement'),
      field('search_light', 'searchLight'),
      field('flare', 'flare'),
      field('defense_id', 'defenseId'),
      field('defense_type_id', 'defenseTypeId'),
      field('ci_type', 'ciType'),
      field('display', 'display'),
      field('hit_type', 'hitType'),
      field('damage', 'damage'),
      field('damage_total', 'damageTotal'),
      field('time', 'time', 'safeInteger'),
      field('origin', 'origin'),
    ],
  },
]

export const communityDumpDatasetNames: readonly CommunityDumpDatasetName[] =
  communityDumpDatasets.map((definition) => definition.dataset)

const datasetNameSet = new Set<string>(communityDumpDatasetNames)

export const isCommunityDumpDatasetName = (value: string): value is CommunityDumpDatasetName =>
  datasetNameSet.has(value)

const datasetsByName = new Map<CommunityDumpDatasetName, CommunityDumpDatasetDefinition>(
  communityDumpDatasets.map((definition) => [definition.dataset, definition]),
)

export const getCommunityDumpDataset = (
  dataset: CommunityDumpDatasetName,
): CommunityDumpDatasetDefinition => {
  const definition = datasetsByName.get(dataset)
  if (!definition) {
    throw new CommunityDumpError(`Unknown Community Dump dataset: ${String(dataset)}`)
  }
  return definition
}
