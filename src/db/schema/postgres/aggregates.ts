import { bigint, integer, jsonb, pgTable, serial, text, uniqueIndex } from 'drizzle-orm/pg-core'

export const selectRankRecords = pgTable(
  'select_rank_records',
  {
    id: serial('id').primaryKey(),
    teitokuId: text('teitoku_id').notNull(),
    teitokuLv: integer('teitoku_lv').notNull(),
    mapareaId: integer('maparea_id').notNull(),
    rank: integer('rank').notNull(),
    origin: text('origin').notNull(),
    rawPayload: jsonb('raw_payload').$type<Record<string, unknown>>().notNull(),
  },
  (table) => [
    uniqueIndex('select_rank_records_teitoku_maparea_unique').on(table.teitokuId, table.mapareaId),
  ],
)

export const recipeRecords = pgTable(
  'recipe_records',
  {
    id: serial('id').primaryKey(),
    recipeId: integer('recipe_id').notNull(),
    itemId: integer('item_id').notNull(),
    stage: integer('stage').notNull(),
    day: integer('day').notNull(),
    secretary: integer('secretary').notNull(),
    fuel: integer('fuel').notNull(),
    ammo: integer('ammo').notNull(),
    steel: integer('steel').notNull(),
    bauxite: integer('bauxite').notNull(),
    reqItemId: integer('req_item_id').notNull(),
    reqItemCount: integer('req_item_count').notNull(),
    buildkit: integer('buildkit').notNull(),
    remodelkit: integer('remodelkit').notNull(),
    certainBuildkit: integer('certain_buildkit').notNull(),
    certainRemodelkit: integer('certain_remodelkit').notNull(),
    upgradeToItemId: integer('upgrade_to_item_id').notNull(),
    upgradeToItemLevel: integer('upgrade_to_item_level').notNull(),
    lastReported: bigint('last_reported', { mode: 'number' }).notNull(),
    count: integer('count').notNull().default(1),
    key: text('key'),
    origin: text('origin'),
    rawPayload: jsonb('raw_payload').$type<Record<string, unknown>>().notNull(),
  },
  (table) => [
    uniqueIndex('recipe_records_unique_key').on(
      table.recipeId,
      table.itemId,
      table.stage,
      table.day,
      table.secretary,
    ),
  ],
)

export const shipStats = pgTable(
  'ship_stats',
  {
    id: serial('id').primaryKey(),
    shipId: integer('ship_id').notNull(),
    lv: integer('lv').notNull(),
    los: integer('los').notNull(),
    losMax: integer('los_max').notNull(),
    asw: integer('asw').notNull(),
    aswMax: integer('asw_max').notNull(),
    evasion: integer('evasion').notNull(),
    evasionMax: integer('evasion_max').notNull(),
    lastTimestamp: bigint('last_timestamp', { mode: 'number' }).notNull(),
    count: integer('count').notNull().default(1),
    rawPayload: jsonb('raw_payload').$type<Record<string, unknown>>().notNull(),
  },
  (table) => [
    uniqueIndex('ship_stats_unique_key').on(
      table.shipId,
      table.lv,
      table.los,
      table.losMax,
      table.asw,
      table.aswMax,
      table.evasion,
      table.evasionMax,
    ),
  ],
)

export const enemyInfos = pgTable(
  'enemy_infos',
  {
    id: serial('id').primaryKey(),
    canonicalHash: text('canonical_hash').notNull(),
    ships1: jsonb('ships1').$type<number[]>().notNull(),
    levels1: jsonb('levels1').$type<number[]>().notNull(),
    hp1: jsonb('hp1').$type<number[]>().notNull(),
    stats1: jsonb('stats1').$type<number[][]>().notNull(),
    equips1: jsonb('equips1').$type<number[][]>().notNull(),
    ships2: jsonb('ships2').$type<number[]>().notNull(),
    levels2: jsonb('levels2').$type<number[]>().notNull(),
    hp2: jsonb('hp2').$type<number[]>().notNull(),
    stats2: jsonb('stats2').$type<number[][]>().notNull(),
    equips2: jsonb('equips2').$type<number[][]>().notNull(),
    planes: integer('planes').notNull(),
    bombersMin: integer('bombers_min').notNull(),
    bombersMax: integer('bombers_max').notNull(),
    count: integer('count').notNull().default(1),
    rawPayload: jsonb('raw_payload').$type<Record<string, unknown>>().notNull(),
  },
  (table) => [uniqueIndex('enemy_infos_canonical_hash_unique').on(table.canonicalHash)],
)

export const quests = pgTable(
  'quests',
  {
    id: serial('id').primaryKey(),
    key: text('key').notNull(),
    questId: integer('quest_id').notNull(),
    title: text('title').notNull(),
    detail: text('detail').notNull(),
    category: integer('category').notNull(),
    type: integer('type').notNull(),
    origin: text('origin'),
    rawPayload: jsonb('raw_payload').$type<Record<string, unknown>>().notNull(),
  },
  (table) => [uniqueIndex('quests_unique_key').on(table.key, table.questId, table.category)],
)

export const questRewards = pgTable(
  'quest_rewards',
  {
    id: serial('id').primaryKey(),
    key: text('key').notNull(),
    questId: integer('quest_id').notNull(),
    title: text('title').notNull(),
    detail: text('detail').notNull(),
    category: integer('category').notNull(),
    type: integer('type').notNull(),
    origin: text('origin'),
    selections: integer('selections').array().notNull(),
    material: integer('material').array().notNull(),
    bonus: jsonb('bonus').$type<unknown[]>().notNull(),
    bonusCount: integer('bonus_count').notNull(),
    rawPayload: jsonb('raw_payload').$type<Record<string, unknown>>().notNull(),
  },
  (table) => [
    uniqueIndex('quest_rewards_unique_key').on(
      table.key,
      table.questId,
      table.selections,
      table.bonusCount,
    ),
  ],
)
