import {
  bigint,
  bigserial,
  boolean,
  char,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

const exportIdSql = sql`lpad(to_hex("export_sequence"), 24, '0')`

const baseFactColumns = {
  id: serial('id').primaryKey(),
  exportSequence: bigserial('export_sequence', { mode: 'number' }),
  exportId: char('export_id', { length: 24 }).generatedAlwaysAs(exportIdSql),
  key: text('key').notNull(),
  schemaVersion: integer('schema_version').notNull(),
  recipeId: integer('recipe_id').notNull(),
  itemId: integer('item_id').notNull(),
  day: integer('day').notNull(),
  firstClientObservedAt: bigint('first_client_observed_at', { mode: 'number' }).notNull(),
  lastClientObservedAt: bigint('last_client_observed_at', { mode: 'number' }).notNull(),
  observedSecondShipId: integer('observed_second_ship_id').notNull(),
  observedFlagshipIds: integer('observed_flagship_ids').array().notNull(),
  sources: text('sources').array().notNull(),
  origins: text('origins').array().notNull(),
  firstReported: bigint('first_reported', { mode: 'number' }).notNull(),
  lastReported: bigint('last_reported', { mode: 'number' }).notNull(),
  count: integer('count').notNull().default(1),
  rawPayload: jsonb('raw_payload').$type<Record<string, unknown>>(),
}

export const itemImprovementAvailabilityFacts = pgTable(
  'item_improvement_availability_facts',
  {
    ...baseFactColumns,
  },
  (table) => [
    uniqueIndex('item_improvement_availability_facts_key_unique').on(table.key),
    uniqueIndex('item_improvement_availability_facts_export_id_unique').on(table.exportId),
    index('item_improvement_availability_facts_export_cursor_idx').on(
      table.lastReported,
      table.exportId,
    ),
    index('item_improvement_availability_facts_lookup_idx').on(
      table.itemId,
      table.observedSecondShipId,
      table.day,
    ),
    index('item_improvement_availability_facts_recipe_id_idx').on(table.recipeId),
  ],
)

export const itemImprovementCostFacts = pgTable(
  'item_improvement_cost_facts',
  {
    ...baseFactColumns,
    itemLevel: integer('item_level').notNull(),
    stage: integer('stage').notNull(),
    fuel: integer('fuel').notNull(),
    ammo: integer('ammo').notNull(),
    steel: integer('steel').notNull(),
    bauxite: integer('bauxite').notNull(),
    buildkit: integer('buildkit').notNull(),
    remodelkit: integer('remodelkit').notNull(),
    certainBuildkit: integer('certain_buildkit').notNull(),
    certainRemodelkit: integer('certain_remodelkit').notNull(),
    reqSlotItems: jsonb('req_slot_items').$type<Array<{ id: number; count: number }>>().notNull(),
    reqUseItems: jsonb('req_use_items').$type<Array<{ id: number; count: number }>>().notNull(),
    changeFlag: integer('change_flag').notNull(),
  },
  (table) => [
    uniqueIndex('item_improvement_cost_facts_key_unique').on(table.key),
    uniqueIndex('item_improvement_cost_facts_export_id_unique').on(table.exportId),
    index('item_improvement_cost_facts_export_cursor_idx').on(table.lastReported, table.exportId),
    index('item_improvement_cost_facts_lookup_idx').on(
      table.itemId,
      table.observedSecondShipId,
      table.day,
      table.itemLevel,
    ),
    index('item_improvement_cost_facts_recipe_id_idx').on(table.recipeId),
  ],
)

export const itemImprovementUpdateFacts = pgTable(
  'item_improvement_update_facts',
  {
    ...baseFactColumns,
    itemLevel: integer('item_level').notNull(),
    upgradeToItemId: integer('upgrade_to_item_id').notNull(),
    upgradeToItemLevel: integer('upgrade_to_item_level').notNull(),
    upgradeObserved: boolean('upgrade_observed').notNull(),
  },
  (table) => [
    uniqueIndex('item_improvement_update_facts_key_unique').on(table.key),
    uniqueIndex('item_improvement_update_facts_export_id_unique').on(table.exportId),
    index('item_improvement_update_facts_export_cursor_idx').on(table.lastReported, table.exportId),
    index('item_improvement_update_facts_lookup_idx').on(
      table.itemId,
      table.observedSecondShipId,
      table.day,
      table.itemLevel,
    ),
    index('item_improvement_update_facts_recipe_id_idx').on(table.recipeId),
    index('item_improvement_update_facts_upgrade_to_item_id_idx').on(table.upgradeToItemId),
  ],
)

export const statefulFactTables = {
  itemImprovementAvailabilityFacts,
  itemImprovementCostFacts,
  itemImprovementUpdateFacts,
} as const
