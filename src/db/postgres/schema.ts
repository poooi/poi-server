import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgSequence,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'

/**
 * PostgreSQL schema seam. Follows docs/postgresql-migration-plan.md lines 372-621 (exact
 * schema contract) and 767-810 (indexes/constraints) exactly. Observation tables are
 * declared here as plain (non-partitioned) Drizzle tables; monthly range partitioning is
 * applied by migration SQL that Drizzle cannot express (see summary for details).
 */

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea'
  },
})

const clockTimestamp = sql`clock_timestamp()`

// Shared sequence backing every item-improvement Fact table's `id`/`export_id` pair, so
// export IDs stay monotonic and unique across all three tables.
export const itemImprovementFactIdSequence = pgSequence('item_improvement_fact_id_seq')

// Internal table used only for startup schema-compatibility checks; not part of the
// migration plan's public contract.
export const schemaMetadata = pgTable(
  'schema_metadata',
  {
    singleton: boolean().primaryKey().default(true),
    version: integer().notNull(),
  },
  (t) => [check('schema_metadata_singleton_true', sql`${t.singleton} = true`)],
)

// ---------------------------------------------------------------------------------------
// Control tables
// ---------------------------------------------------------------------------------------

export const dataEpochs = pgTable(
  'data_epochs',
  {
    singleton: boolean().primaryKey().default(true),
    id: uuid().notNull().unique(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(clockTimestamp),
  },
  (t) => [check('data_epochs_singleton_true', sql`${t.singleton} = true`)],
)

export const dataDumpRuns = pgTable(
  'data_dump_runs',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    epochId: uuid('epoch_id')
      .notNull()
      .references(() => dataEpochs.id),
    dumpMonth: date('dump_month', { mode: 'string' }).notNull(),
    schemaVersion: integer('schema_version').notNull(),
    status: text().notNull(),
    manifestObjectKey: text('manifest_object_key'),
    manifestBytes: bigint('manifest_bytes', { mode: 'number' }),
    manifestSha256: bytea('manifest_sha256'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    cleanupEligibleAt: timestamp('cleanup_eligible_at', { withTimezone: true }),
    cleanedAt: timestamp('cleaned_at', { withTimezone: true }),
    error: text(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(clockTimestamp),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(clockTimestamp),
  },
  (t) => [
    unique('data_dump_runs_epoch_month_version_key').on(t.epochId, t.dumpMonth, t.schemaVersion),
    check(
      'data_dump_runs_status_check',
      sql`${t.status} in ('pending', 'exporting', 'uploaded', 'published', 'cleanup_eligible', 'cleaned', 'failed')`,
    ),
    check(
      'data_dump_runs_manifest_bytes_nonnegative',
      sql`${t.manifestBytes} is null or ${t.manifestBytes} >= 0`,
    ),
    check(
      'data_dump_runs_manifest_sha256_length',
      sql`${t.manifestSha256} is null or octet_length(${t.manifestSha256}) = 32`,
    ),
    check(
      'data_dump_runs_cleanup_eligible_at_offset',
      sql`${t.cleanupEligibleAt} is null or ${t.publishedAt} is null or ${t.cleanupEligibleAt} = ${t.publishedAt} + interval '168 hours'`,
    ),
  ],
)

export const dataDumpFiles = pgTable(
  'data_dump_files',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    dumpRunId: bigint('dump_run_id', { mode: 'number' })
      .notNull()
      .references(() => dataDumpRuns.id, { onDelete: 'restrict' }),
    dataset: text().notNull(),
    partitionName: text('partition_name').notNull(),
    objectKey: text('object_key').notNull(),
    rowCount: bigint('row_count', { mode: 'number' }).notNull(),
    compressedBytes: bigint('compressed_bytes', { mode: 'number' }).notNull(),
    sha256: bytea().notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
  },
  (t) => [
    unique('data_dump_files_dump_run_dataset_key').on(t.dumpRunId, t.dataset),
    check(
      'data_dump_files_dataset_check',
      sql`${t.dataset} in ('createShipObservations', 'createItemObservations', 'remodelItemObservations', 'dropShipObservations', 'passEventObservations', 'battleApiObservations', 'nightContactObservations', 'aaciObservations', 'nightBattleCiObservations')`,
    ),
    check('data_dump_files_row_count_nonnegative', sql`${t.rowCount} >= 0`),
    check('data_dump_files_compressed_bytes_nonnegative', sql`${t.compressedBytes} >= 0`),
    check('data_dump_files_sha256_length', sql`octet_length(${t.sha256}) = 32`),
  ],
)

// ---------------------------------------------------------------------------------------
// Observation tables
//
// Every Observation table has `id bigint identity` and `ingested_at timestamptz`, with a
// composite primary key of `(ingested_at, id)`. Monthly range partitioning by `ingested_at`
// (with a default safety-net partition) is applied by hand-written migration SQL; Drizzle's
// schema builder has no first-class `PARTITION BY` support (see summary).
// ---------------------------------------------------------------------------------------

export const createShipRecords = pgTable(
  'create_ship_records',
  {
    id: bigint({ mode: 'number' }).notNull().generatedAlwaysAsIdentity(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().default(clockTimestamp),
    items: integer().array().default([]),
    kdockId: integer('kdock_id'),
    secretary: integer(),
    shipId: integer('ship_id'),
    highspeed: integer(),
    teitokuLv: integer('teitoku_lv'),
    largeFlag: boolean('large_flag'),
    origin: text(),
  },
  (t) => [primaryKey({ columns: [t.ingestedAt, t.id] })],
)

export const createItemRecords = pgTable(
  'create_item_records',
  {
    id: bigint({ mode: 'number' }).notNull().generatedAlwaysAsIdentity(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().default(clockTimestamp),
    items: integer().array().default([]),
    secretary: integer(),
    itemId: integer('item_id'),
    teitokuLv: integer('teitoku_lv'),
    successful: boolean(),
    origin: text(),
  },
  (t) => [primaryKey({ columns: [t.ingestedAt, t.id] })],
)

export const remodelItemRecords = pgTable(
  'remodel_item_records',
  {
    id: bigint({ mode: 'number' }).notNull().generatedAlwaysAsIdentity(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().default(clockTimestamp),
    successful: boolean(),
    itemId: integer('item_id'),
    itemLevel: integer('item_level'),
    flagshipId: integer('flagship_id'),
    flagshipLevel: integer('flagship_level'),
    flagshipCond: integer('flagship_cond'),
    consortId: integer('consort_id'),
    consortLevel: integer('consort_level'),
    consortCond: integer('consort_cond'),
    teitokuLv: integer('teitoku_lv'),
    certain: boolean(),
  },
  (t) => [primaryKey({ columns: [t.ingestedAt, t.id] })],
)

export const dropShipRecords = pgTable(
  'drop_ship_records',
  {
    id: bigint({ mode: 'number' }).notNull().generatedAlwaysAsIdentity(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().default(clockTimestamp),
    shipId: integer('ship_id'),
    itemId: integer('item_id'),
    mapId: integer('map_id'),
    quest: text(),
    cellId: integer('cell_id'),
    enemy: text(),
    rank: text(),
    isBoss: boolean('is_boss'),
    teitokuLv: integer('teitoku_lv'),
    mapLv: integer('map_lv'),
    enemyShips1: integer('enemy_ships1').array().default([]),
    enemyShips2: integer('enemy_ships2').array().default([]),
    enemyFormation: integer('enemy_formation'),
    baseExp: integer('base_exp'),
    teitokuId: text('teitoku_id'),
    ownedShipSnapshot: jsonb('owned_ship_snapshot'),
    origin: text(),
  },
  (t) => [primaryKey({ columns: [t.ingestedAt, t.id] })],
)

export const passEventRecords = pgTable(
  'pass_event_records',
  {
    id: bigint({ mode: 'number' }).notNull().generatedAlwaysAsIdentity(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().default(clockTimestamp),
    teitokuId: text('teitoku_id'),
    teitokuLv: integer('teitoku_lv'),
    mapId: integer('map_id'),
    mapLv: integer('map_lv'),
    rewards: jsonb().default([]),
    origin: text(),
  },
  (t) => [primaryKey({ columns: [t.ingestedAt, t.id] })],
)

export const battleApis = pgTable(
  'battle_apis',
  {
    id: bigint({ mode: 'number' }).notNull().generatedAlwaysAsIdentity(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().default(clockTimestamp),
    origin: text(),
    path: text(),
    data: jsonb(),
  },
  (t) => [primaryKey({ columns: [t.ingestedAt, t.id] })],
)

export const nightContacts = pgTable(
  'night_contacts',
  {
    id: bigint({ mode: 'number' }).notNull().generatedAlwaysAsIdentity(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().default(clockTimestamp),
    fleetType: integer('fleet_type'),
    shipId: integer('ship_id'),
    shipLv: integer('ship_lv'),
    itemId: integer('item_id'),
    itemLv: integer('item_lv'),
    contact: boolean(),
  },
  (t) => [primaryKey({ columns: [t.ingestedAt, t.id] })],
)

export const aaciRecords = pgTable(
  'aaci_records',
  {
    id: bigint({ mode: 'number' }).notNull().generatedAlwaysAsIdentity(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().default(clockTimestamp),
    poiVersion: text('poi_version'),
    available: integer().array().default([]),
    triggered: integer(),
    items: integer().array().default([]),
    improvement: integer().array().default([]),
    rawLuck: integer('raw_luck'),
    rawTaiku: integer('raw_taiku'),
    lv: integer(),
    hpPercent: doublePrecision('hp_percent'),
    pos: integer(),
    origin: text(),
  },
  (t) => [primaryKey({ columns: [t.ingestedAt, t.id] })],
)

export const nightBattleCis = pgTable(
  'night_battle_cis',
  {
    id: bigint({ mode: 'number' }).notNull().generatedAlwaysAsIdentity(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().default(clockTimestamp),
    shipId: integer('ship_id'),
    ci: text(),
    type: text(),
    lv: integer(),
    rawLuck: integer('raw_luck'),
    pos: integer(),
    status: text(),
    items: integer().array().default([]),
    improvement: integer().array().default([]),
    searchLight: boolean('search_light'),
    flare: integer(),
    defenseId: integer('defense_id'),
    defenseTypeId: integer('defense_type_id'),
    ciType: integer('ci_type'),
    display: integer().array().default([]),
    hitType: integer('hit_type').array().default([]),
    damage: doublePrecision().array().default([]),
    damageTotal: doublePrecision('damage_total'),
    time: bigint({ mode: 'number' }),
    origin: text(),
  },
  (t) => [primaryKey({ columns: [t.ingestedAt, t.id] })],
)

// ---------------------------------------------------------------------------------------
// Current State, Aggregate, and Definition tables
// ---------------------------------------------------------------------------------------

export const selectRankRecords = pgTable(
  'select_rank_records',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    teitokuId: text('teitoku_id').notNull(),
    mapareaId: integer('maparea_id').notNull(),
    teitokuLv: integer('teitoku_lv'),
    rank: integer(),
    origin: text(),
  },
  (t) => [unique('select_rank_records_teitoku_maparea_key').on(t.teitokuId, t.mapareaId)],
)

export const recipeRecords = pgTable(
  'recipe_records',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    recipeId: integer('recipe_id').notNull(),
    itemId: integer('item_id').notNull(),
    stage: integer().notNull(),
    day: integer().notNull(),
    secretary: integer().notNull(),
    fuel: integer(),
    ammo: integer(),
    steel: integer(),
    bauxite: integer(),
    reqItemId: integer('req_item_id'),
    reqItemCount: integer('req_item_count'),
    buildkit: integer(),
    remodelkit: integer(),
    certainBuildkit: integer('certain_buildkit'),
    certainRemodelkit: integer('certain_remodelkit'),
    upgradeToItemId: integer('upgrade_to_item_id'),
    upgradeToItemLevel: integer('upgrade_to_item_level'),
    key: text(),
    origin: text(),
    lastReported: bigint('last_reported', { mode: 'number' }).notNull(),
    count: bigint({ mode: 'number' }).notNull().default(1),
  },
  (t) => [
    unique('recipe_records_identity_key').on(t.recipeId, t.itemId, t.stage, t.day, t.secretary),
  ],
)

export const shipStats = pgTable(
  'ship_stats',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    shipId: integer('ship_id').notNull(),
    lv: integer().notNull(),
    los: integer().notNull(),
    losMax: integer('los_max').notNull(),
    asw: integer().notNull(),
    aswMax: integer('asw_max').notNull(),
    evasion: integer().notNull(),
    evasionMax: integer('evasion_max').notNull(),
    lastTimestamp: bigint('last_timestamp', { mode: 'number' }).notNull(),
    count: bigint({ mode: 'number' }).notNull().default(1),
  },
  (t) => [
    unique('ship_stats_identity_key').on(
      t.shipId,
      t.lv,
      t.los,
      t.losMax,
      t.asw,
      t.aswMax,
      t.evasion,
      t.evasionMax,
    ),
  ],
)

export const enemyInfos = pgTable(
  'enemy_infos',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    identityHash: bytea('identity_hash').notNull().unique(),
    ships1: integer().array().notNull(),
    levels1: integer().array().notNull(),
    hp1: integer().array().notNull(),
    ships2: integer().array().notNull(),
    levels2: integer().array().notNull(),
    hp2: integer().array().notNull(),
    stats1: jsonb().notNull(),
    equips1: jsonb().notNull(),
    stats2: jsonb().notNull(),
    equips2: jsonb().notNull(),
    planes: integer().notNull(),
    bombersMin: integer('bombers_min'),
    bombersMax: integer('bombers_max'),
    count: bigint({ mode: 'number' }).notNull().default(1),
  },
  (t) => [check('enemy_infos_identity_hash_length', sql`octet_length(${t.identityHash}) = 32`)],
)

export const quests = pgTable(
  'quests',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    key: text().notNull(),
    questId: integer('quest_id').notNull(),
    title: text().notNull(),
    detail: text().notNull(),
    category: integer().notNull(),
    type: integer(),
    origin: text(),
  },
  (t) => [
    unique('quests_key_quest_id_category_key').on(t.key, t.questId, t.category),
    check('quests_key_format', sql`${t.key} ~ '^[0-9a-f]{32}$'`),
  ],
)

export const questRewards = pgTable(
  'quest_rewards',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    key: text().notNull(),
    questId: integer('quest_id').notNull(),
    title: text().notNull(),
    detail: text().notNull(),
    category: integer(),
    type: integer(),
    origin: text(),
    selections: integer().array().notNull(),
    material: integer().array().default([]),
    bonus: jsonb().default([]),
    bonusCount: integer('bonus_count').notNull(),
  },
  (t) => [
    unique('quest_rewards_key_quest_id_selections_bonus_count_key').on(
      t.key,
      t.questId,
      t.selections,
      t.bonusCount,
    ),
    check('quest_rewards_key_format', sql`${t.key} ~ '^[0-9a-f]{32}$'`),
  ],
)

// ---------------------------------------------------------------------------------------
// Item-improvement Fact tables
//
// All three tables share `item_improvement_fact_id_seq` so their `id`/`export_id` pairs are
// monotonic and unique across tables, matching the plan's "shared sequence" requirement.
// ---------------------------------------------------------------------------------------

const itemImprovementFactIdDefault = sql`nextval('item_improvement_fact_id_seq')`
const exportIdGenerated = sql`lpad(to_hex(id), 24, '0')`

export const itemImprovementAvailabilityFacts = pgTable(
  'item_improvement_availability_facts',
  {
    id: bigint({ mode: 'number' }).primaryKey().default(itemImprovementFactIdDefault),
    exportId: text('export_id').notNull().unique().generatedAlwaysAs(exportIdGenerated),
    key: text().notNull().unique(),
    schemaVersion: integer('schema_version').notNull(),
    recipeId: integer('recipe_id').notNull(),
    itemId: integer('item_id').notNull(),
    day: integer().notNull(),
    firstClientObservedAt: bigint('first_client_observed_at', { mode: 'number' }).notNull(),
    lastClientObservedAt: bigint('last_client_observed_at', { mode: 'number' }).notNull(),
    observedSecondShipId: integer('observed_second_ship_id').notNull(),
    observedFlagshipIds: integer('observed_flagship_ids').array().notNull().default([]),
    sources: text().array().notNull().default([]),
    origins: text().array().notNull().default([]),
    firstReported: bigint('first_reported', { mode: 'number' }).notNull(),
    lastReported: bigint('last_reported', { mode: 'number' }).notNull(),
    count: bigint({ mode: 'number' }).notNull().default(1),
  },
  (t) => [
    check(
      'item_improvement_availability_facts_export_id_format',
      sql`${t.exportId} ~ '^[0-9a-f]{24}$'`,
    ),
    index('item_improvement_availability_facts_last_reported_export_id_idx').on(
      t.lastReported,
      t.exportId,
    ),
    index('item_improvement_availability_facts_lookup_idx').on(
      t.itemId,
      t.observedSecondShipId,
      t.day,
    ),
    index('item_improvement_availability_facts_recipe_id_idx').on(t.recipeId),
  ],
)

export const itemImprovementCostFacts = pgTable(
  'item_improvement_cost_facts',
  {
    id: bigint({ mode: 'number' }).primaryKey().default(itemImprovementFactIdDefault),
    exportId: text('export_id').notNull().unique().generatedAlwaysAs(exportIdGenerated),
    key: text().notNull().unique(),
    schemaVersion: integer('schema_version').notNull(),
    recipeId: integer('recipe_id').notNull(),
    itemId: integer('item_id').notNull(),
    day: integer().notNull(),
    firstClientObservedAt: bigint('first_client_observed_at', { mode: 'number' }).notNull(),
    lastClientObservedAt: bigint('last_client_observed_at', { mode: 'number' }).notNull(),
    observedSecondShipId: integer('observed_second_ship_id').notNull(),
    observedFlagshipIds: integer('observed_flagship_ids').array().notNull().default([]),
    sources: text().array().notNull().default([]),
    origins: text().array().notNull().default([]),
    firstReported: bigint('first_reported', { mode: 'number' }).notNull(),
    lastReported: bigint('last_reported', { mode: 'number' }).notNull(),
    count: bigint({ mode: 'number' }).notNull().default(1),
    itemLevel: integer('item_level').notNull(),
    stage: integer().notNull(),
    fuel: integer().notNull(),
    ammo: integer().notNull(),
    steel: integer().notNull(),
    bauxite: integer().notNull(),
    buildkit: integer().notNull(),
    remodelkit: integer().notNull(),
    certainBuildkit: integer('certain_buildkit').notNull(),
    certainRemodelkit: integer('certain_remodelkit').notNull(),
    reqSlotItems: jsonb('req_slot_items').notNull(),
    reqUseItems: jsonb('req_use_items').notNull(),
    changeFlag: integer('change_flag').notNull(),
  },
  (t) => [
    check('item_improvement_cost_facts_export_id_format', sql`${t.exportId} ~ '^[0-9a-f]{24}$'`),
    index('item_improvement_cost_facts_last_reported_export_id_idx').on(t.lastReported, t.exportId),
    index('item_improvement_cost_facts_lookup_idx').on(
      t.itemId,
      t.observedSecondShipId,
      t.day,
      t.itemLevel,
    ),
    index('item_improvement_cost_facts_recipe_id_idx').on(t.recipeId),
  ],
)

export const itemImprovementUpdateFacts = pgTable(
  'item_improvement_update_facts',
  {
    id: bigint({ mode: 'number' }).primaryKey().default(itemImprovementFactIdDefault),
    exportId: text('export_id').notNull().unique().generatedAlwaysAs(exportIdGenerated),
    key: text().notNull().unique(),
    schemaVersion: integer('schema_version').notNull(),
    recipeId: integer('recipe_id').notNull(),
    itemId: integer('item_id').notNull(),
    day: integer().notNull(),
    firstClientObservedAt: bigint('first_client_observed_at', { mode: 'number' }).notNull(),
    lastClientObservedAt: bigint('last_client_observed_at', { mode: 'number' }).notNull(),
    observedSecondShipId: integer('observed_second_ship_id').notNull(),
    observedFlagshipIds: integer('observed_flagship_ids').array().notNull().default([]),
    sources: text().array().notNull().default([]),
    origins: text().array().notNull().default([]),
    firstReported: bigint('first_reported', { mode: 'number' }).notNull(),
    lastReported: bigint('last_reported', { mode: 'number' }).notNull(),
    count: bigint({ mode: 'number' }).notNull().default(1),
    itemLevel: integer('item_level').notNull(),
    upgradeToItemId: integer('upgrade_to_item_id').notNull(),
    upgradeToItemLevel: integer('upgrade_to_item_level').notNull(),
    upgradeObserved: boolean('upgrade_observed').notNull().default(true),
  },
  (t) => [
    check('item_improvement_update_facts_export_id_format', sql`${t.exportId} ~ '^[0-9a-f]{24}$'`),
    index('item_improvement_update_facts_last_reported_export_id_idx').on(
      t.lastReported,
      t.exportId,
    ),
    index('item_improvement_update_facts_lookup_idx').on(
      t.itemId,
      t.observedSecondShipId,
      t.day,
      t.itemLevel,
    ),
    index('item_improvement_update_facts_recipe_id_idx').on(t.recipeId),
    index('item_improvement_update_facts_upgrade_to_item_id_idx').on(t.upgradeToItemId),
  ],
)
