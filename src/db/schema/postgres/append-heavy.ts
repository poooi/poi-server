import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'

const ingestedAtColumn = timestamp('ingested_at', { withTimezone: true, mode: 'date' })
  .notNull()
  .defaultNow()

const rawPayloadColumn = jsonb('raw_payload').$type<Record<string, unknown>>().notNull()

export const createShipRecords = pgTable('create_ship_records', {
  id: serial('id').primaryKey(),
  items: integer('items').array().notNull(),
  kdockId: integer('kdock_id').notNull(),
  secretary: integer('secretary').notNull(),
  shipId: integer('ship_id').notNull(),
  highspeed: integer('highspeed').notNull(),
  teitokuLv: integer('teitoku_lv').notNull(),
  largeFlag: boolean('large_flag').notNull(),
  origin: text('origin').notNull(),
  ingestedAt: ingestedAtColumn,
  rawPayload: rawPayloadColumn,
})

export const createItemRecords = pgTable('create_item_records', {
  id: serial('id').primaryKey(),
  items: integer('items').array().notNull(),
  secretary: integer('secretary').notNull(),
  itemId: integer('item_id').notNull(),
  teitokuLv: integer('teitoku_lv').notNull(),
  successful: boolean('successful').notNull(),
  origin: text('origin').notNull(),
  ingestedAt: ingestedAtColumn,
  rawPayload: rawPayloadColumn,
})

export const remodelItemRecords = pgTable('remodel_item_records', {
  id: serial('id').primaryKey(),
  successful: boolean('successful').notNull(),
  itemId: integer('item_id').notNull(),
  itemLevel: integer('item_level').notNull(),
  flagshipId: integer('flagship_id').notNull(),
  flagshipLevel: integer('flagship_level').notNull(),
  flagshipCond: integer('flagship_cond').notNull(),
  consortId: integer('consort_id').notNull(),
  consortLevel: integer('consort_level').notNull(),
  consortCond: integer('consort_cond').notNull(),
  teitokuLv: integer('teitoku_lv').notNull(),
  certain: boolean('certain').notNull(),
  ingestedAt: ingestedAtColumn,
  rawPayload: rawPayloadColumn,
})

export const dropShipRecords = pgTable('drop_ship_records', {
  id: serial('id').primaryKey(),
  shipId: integer('ship_id').notNull(),
  itemId: integer('item_id').notNull(),
  mapId: integer('map_id').notNull(),
  quest: text('quest').notNull(),
  cellId: integer('cell_id').notNull(),
  enemy: text('enemy').notNull(),
  rank: text('rank').notNull(),
  isBoss: boolean('is_boss').notNull(),
  teitokuLv: integer('teitoku_lv').notNull(),
  mapLv: integer('map_lv').notNull(),
  enemyShips1: integer('enemy_ships1').array().notNull(),
  enemyShips2: integer('enemy_ships2').array().notNull(),
  enemyFormation: integer('enemy_formation').notNull(),
  baseExp: integer('base_exp').notNull(),
  teitokuId: text('teitoku_id').notNull(),
  ownedShipSnapshot: jsonb('owned_ship_snapshot').$type<Record<string, unknown>>().notNull(),
  origin: text('origin').notNull(),
  ingestedAt: ingestedAtColumn,
  rawPayload: rawPayloadColumn,
})

export const passEventRecords = pgTable('pass_event_records', {
  id: serial('id').primaryKey(),
  teitokuId: text('teitoku_id').notNull(),
  teitokuLv: integer('teitoku_lv').notNull(),
  mapId: integer('map_id').notNull(),
  mapLv: integer('map_lv').notNull(),
  rewards: jsonb('rewards').$type<unknown[]>().notNull(),
  origin: text('origin').notNull(),
  ingestedAt: ingestedAtColumn,
  rawPayload: rawPayloadColumn,
})

export const battleApis = pgTable('battle_apis', {
  id: serial('id').primaryKey(),
  origin: text('origin').notNull(),
  path: text('path').notNull(),
  data: jsonb('data').$type<Record<string, unknown>>().notNull(),
  ingestedAt: ingestedAtColumn,
  rawPayload: rawPayloadColumn,
})

export const nightContacts = pgTable('night_contacts', {
  id: serial('id').primaryKey(),
  fleetType: integer('fleet_type').notNull(),
  shipId: integer('ship_id').notNull(),
  shipLv: integer('ship_lv').notNull(),
  itemId: integer('item_id').notNull(),
  itemLv: integer('item_lv').notNull(),
  contact: boolean('contact').notNull(),
  ingestedAt: ingestedAtColumn,
  rawPayload: rawPayloadColumn,
})

export const aaciRecords = pgTable('aaci_records', {
  id: serial('id').primaryKey(),
  poiVersion: text('poi_version').notNull(),
  available: integer('available').array().notNull(),
  triggered: integer('triggered').notNull(),
  items: integer('items').array().notNull(),
  improvement: integer('improvement').array().notNull(),
  rawLuck: integer('raw_luck').notNull(),
  rawTaiku: integer('raw_taiku').notNull(),
  lv: integer('lv').notNull(),
  hpPercent: integer('hp_percent').notNull(),
  pos: integer('pos').notNull(),
  origin: text('origin').notNull(),
  ingestedAt: ingestedAtColumn,
  rawPayload: rawPayloadColumn,
})

export const nightBattleCis = pgTable('night_battle_cis', {
  id: serial('id').primaryKey(),
  shipId: integer('ship_id').notNull(),
  ci: text('ci').notNull(),
  type: text('type').notNull(),
  lv: integer('lv').notNull(),
  rawLuck: integer('raw_luck').notNull(),
  pos: integer('pos').notNull(),
  status: text('status').notNull(),
  items: integer('items').array().notNull(),
  improvement: integer('improvement').array().notNull(),
  searchLight: boolean('search_light').notNull(),
  flare: integer('flare').notNull(),
  defenseId: integer('defense_id').notNull(),
  defenseTypeId: integer('defense_type_id').notNull(),
  ciType: integer('ci_type').notNull(),
  display: integer('display').array().notNull(),
  hitType: integer('hit_type').array().notNull(),
  damage: integer('damage').array().notNull(),
  damageTotal: integer('damage_total').notNull(),
  time: bigint('time', { mode: 'number' }).notNull(),
  origin: text('origin').notNull(),
  ingestedAt: ingestedAtColumn,
  rawPayload: rawPayloadColumn,
})

// Future dump/cleanup automation should only target these write-only append-heavy report tables.
export const dumpableAppendHeavyTables = {
  createShipRecords,
  createItemRecords,
  remodelItemRecords,
  dropShipRecords,
  passEventRecords,
  battleApis,
  nightContacts,
  aaciRecords,
  nightBattleCis,
} as const
