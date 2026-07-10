import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import { stripSqliteDatabaseUrl } from '../backend'
import {
  createItemImprovementAvailabilityKey,
  createItemImprovementCostKey,
  createItemImprovementUpdateKey,
  type ItemImprovementAvailabilityKeyFields,
  type ItemImprovementCostKeyFields,
  type ItemImprovementUpdateKeyFields,
} from '../../models/report/item-improvement-key'
import { acquireOperationalMigrationLock } from './month-lock'

let operationalDb: Database.Database | undefined

const ensureOperationalSchema = (db: Database.Database) => {
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('busy_timeout = 5000')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS quests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL,
      quest_id INTEGER,
      category INTEGER,
      type INTEGER,
      title TEXT,
      detail TEXT,
      origin TEXT,
      UNIQUE (key, quest_id, category)
    );

    CREATE TABLE IF NOT EXISTS quest_rewards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL,
      quest_id INTEGER,
      title TEXT,
      detail TEXT,
      category INTEGER,
      type INTEGER,
      selections_json TEXT NOT NULL,
      material_json TEXT NOT NULL,
      bonus_json TEXT NOT NULL,
      bouns_count INTEGER,
      origin TEXT,
      UNIQUE (key, quest_id, selections_json, bouns_count)
    );

    CREATE TABLE IF NOT EXISTS select_rank_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teitoku_id TEXT NOT NULL,
      maparea_id INTEGER NOT NULL,
      teitoku_lv INTEGER,
      rank INTEGER,
      origin TEXT,
      UNIQUE (teitoku_id, maparea_id)
    );

    CREATE TABLE IF NOT EXISTS recipe_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipe_id INTEGER,
      item_id INTEGER,
      stage INTEGER,
      day INTEGER,
      secretary INTEGER,
      payload_json TEXT NOT NULL,
      last_reported INTEGER,
      count INTEGER NOT NULL DEFAULT 0,
      UNIQUE (recipe_id, item_id, stage, day, secretary)
    );

    CREATE TABLE IF NOT EXISTS ship_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stat_key TEXT NOT NULL UNIQUE,
      payload_json TEXT NOT NULL,
      last_timestamp INTEGER,
      count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS enemy_infos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      enemy_key TEXT NOT NULL UNIQUE,
      payload_json TEXT NOT NULL,
      bombers_min INTEGER,
      bombers_max INTEGER,
      count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS operational_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      origin TEXT,
      created_at_ms INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS operational_records_kind_idx ON operational_records (kind);

    CREATE TABLE IF NOT EXISTS item_improvement_availability_facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      schema_version INTEGER,
      recipe_id INTEGER,
      item_id INTEGER,
      day INTEGER,
      observed_second_ship_id INTEGER,
      observed_flagship_ids_json TEXT NOT NULL,
      sources_json TEXT NOT NULL,
      first_reported INTEGER,
      last_reported INTEGER,
      first_client_observed_at INTEGER,
      last_client_observed_at INTEGER,
      count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS item_improvement_cost_facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      schema_version INTEGER,
      recipe_id INTEGER,
      item_id INTEGER,
      item_level INTEGER,
      stage INTEGER,
      day INTEGER,
      observed_second_ship_id INTEGER,
      fuel INTEGER,
      ammo INTEGER,
      steel INTEGER,
      bauxite INTEGER,
      buildkit INTEGER,
      remodelkit INTEGER,
      certain_buildkit INTEGER,
      certain_remodelkit INTEGER,
      change_flag INTEGER,
      req_slot_items_json TEXT NOT NULL,
      req_use_items_json TEXT NOT NULL,
      observed_flagship_ids_json TEXT NOT NULL,
      sources_json TEXT NOT NULL,
      first_reported INTEGER,
      last_reported INTEGER,
      first_client_observed_at INTEGER,
      last_client_observed_at INTEGER,
      count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS item_improvement_update_facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      schema_version INTEGER,
      recipe_id INTEGER,
      item_id INTEGER,
      item_level INTEGER,
      day INTEGER,
      observed_second_ship_id INTEGER,
      upgrade_to_item_id INTEGER,
      upgrade_to_item_level INTEGER,
      upgrade_observed INTEGER NOT NULL,
      observed_flagship_ids_json TEXT NOT NULL,
      sources_json TEXT NOT NULL,
      first_reported INTEGER,
      last_reported INTEGER,
      first_client_observed_at INTEGER,
      last_client_observed_at INTEGER,
      count INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS item_improvement_availability_facts_export_idx
      ON item_improvement_availability_facts (last_reported, id);
    CREATE INDEX IF NOT EXISTS item_improvement_cost_facts_export_idx
      ON item_improvement_cost_facts (last_reported, id);
    CREATE INDEX IF NOT EXISTS item_improvement_update_facts_export_idx
      ON item_improvement_update_facts (last_reported, id);
  `)
}

interface ItemImprovementCostMigrationRow {
  count: number
  first_client_observed_at: number
  first_reported: number
  id: number
  key: string
  last_client_observed_at: number
  last_reported: number
  observed_flagship_ids_json: string
  sources_json: string
}

const migrateQuestUniqueness = (db: Database.Database) => {
  const migrate = db.transaction(() => {
    db.exec(`
      DELETE FROM quests
      WHERE id NOT IN (
        SELECT MIN(id)
        FROM quests
        GROUP BY
          key,
          COALESCE('v:' || CAST(quest_id AS TEXT), 'n:'),
          COALESCE('v:' || CAST(category AS TEXT), 'n:')
      );

      DELETE FROM quest_rewards
      WHERE id NOT IN (
        SELECT MIN(id)
        FROM quest_rewards
        GROUP BY
          key,
          COALESCE('v:' || CAST(quest_id AS TEXT), 'n:'),
          selections_json,
          COALESCE('v:' || CAST(bouns_count AS TEXT), 'n:')
      );

      CREATE UNIQUE INDEX IF NOT EXISTS quests_null_stable_key_idx
        ON quests (
          key,
          COALESCE('v:' || CAST(quest_id AS TEXT), 'n:'),
          COALESCE('v:' || CAST(category AS TEXT), 'n:')
        );

      CREATE UNIQUE INDEX IF NOT EXISTS quest_rewards_null_stable_key_idx
        ON quest_rewards (
          key,
          COALESCE('v:' || CAST(quest_id AS TEXT), 'n:'),
          selections_json,
          COALESCE('v:' || CAST(bouns_count AS TEXT), 'n:')
        );
    `)
  })
  migrate.immediate()
}

const migrateItemImprovementCostKeys = (db: Database.Database) => {
  const selectRows = db.prepare('SELECT * FROM item_improvement_cost_facts ORDER BY id')
  const findByKey = db.prepare('SELECT * FROM item_improvement_cost_facts WHERE key = ?')
  const updateKey = db.prepare('UPDATE item_improvement_cost_facts SET key = ? WHERE id = ?')
  const mergeIntoTarget = db.prepare(`
    UPDATE item_improvement_cost_facts
    SET
      observed_flagship_ids_json = ?,
      sources_json = ?,
      first_reported = ?,
      last_reported = ?,
      first_client_observed_at = ?,
      last_client_observed_at = ?,
      count = ?
    WHERE id = ?
  `)
  const deleteById = db.prepare('DELETE FROM item_improvement_cost_facts WHERE id = ?')
  const migrate = db.transaction(() => {
    const rows = selectRows.all() as Array<ItemImprovementCostMigrationRow & Record<string, any>>
    for (const row of rows) {
      const canonicalKey = createItemImprovementCostKey({
        ammo: row.ammo,
        bauxite: row.bauxite,
        buildkit: row.buildkit,
        certainBuildkit: row.certain_buildkit,
        certainRemodelkit: row.certain_remodelkit,
        changeFlag: row.change_flag,
        day: row.day,
        fuel: row.fuel,
        itemId: row.item_id,
        itemLevel: row.item_level,
        observedSecondShipId: row.observed_second_ship_id,
        recipeId: row.recipe_id,
        remodelkit: row.remodelkit,
        reqSlotItems: JSON.parse(row.req_slot_items_json),
        reqUseItems: JSON.parse(row.req_use_items_json),
        stage: row.stage,
        steel: row.steel,
      })
      if (row.key === canonicalKey) {
        continue
      }

      const target = findByKey.get(canonicalKey) as
        (ItemImprovementCostMigrationRow & Record<string, any>) | undefined
      if (target == null) {
        updateKey.run(canonicalKey, row.id)
        continue
      }
      if (target.id === row.id) {
        continue
      }

      mergeIntoTarget.run(
        JSON.stringify(
          mergeJsonNumberArray(
            target.observed_flagship_ids_json,
            JSON.parse(row.observed_flagship_ids_json),
          ),
        ),
        JSON.stringify(mergeJsonStringArray(target.sources_json, JSON.parse(row.sources_json))),
        Math.min(target.first_reported, row.first_reported),
        Math.max(target.last_reported, row.last_reported),
        Math.min(target.first_client_observed_at, row.first_client_observed_at),
        Math.max(target.last_client_observed_at, row.last_client_observed_at),
        target.count + row.count,
        target.id,
      )
      deleteById.run(row.id)
    }
  })
  migrate.immediate()
}

export const initializeSqliteOperationalStorage = async (db: string) => {
  closeSqliteOperationalStorage()
  const sqlitePath = stripSqliteDatabaseUrl(db)
  fs.mkdirSync(path.dirname(sqlitePath), { recursive: true })
  const nextOperationalDb = new Database(sqlitePath)
  try {
    const migrationLock = await acquireOperationalMigrationLock(sqlitePath)
    try {
      ensureOperationalSchema(nextOperationalDb)
      migrateQuestUniqueness(nextOperationalDb)
      migrateItemImprovementCostKeys(nextOperationalDb)
    } finally {
      await migrationLock.release()
    }
  } catch (err) {
    nextOperationalDb.close()
    throw err
  }
  operationalDb = nextOperationalDb
}

export const closeSqliteOperationalStorage = () => {
  const db = operationalDb
  operationalDb = undefined
  db?.close()
}

const getOperationalDb = () => {
  if (operationalDb == null) {
    throw new Error('SQLite operational database is not initialized')
  }
  return operationalDb
}

const mergeJsonNumberArray = (existingJson: string | undefined, incoming: number[]) =>
  Array.from(
    new Set([...(existingJson == null ? [] : JSON.parse(existingJson)), ...incoming]),
  ).sort((a, b) => a - b)

const mergeJsonStringArray = (existingJson: string | undefined, incoming: string[]) =>
  Array.from(
    new Set([...(existingJson == null ? [] : JSON.parse(existingJson)), ...incoming]),
  ).sort()

export const upsertQuestRecords = (records: Array<Record<string, any>>) => {
  const db = getOperationalDb()
  const insert = db.prepare(`
    INSERT OR IGNORE INTO quests (
      key,
      quest_id,
      category,
      type,
      title,
      detail,
      origin
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  const insertAll = db.transaction((items: Array<Record<string, any>>) => {
    for (const item of items) {
      insert.run(
        item.key,
        item.questId,
        item.category,
        item.type,
        item.title,
        item.detail,
        item.origin,
      )
    }
  })
  insertAll(records)
}

export const getKnownQuestKeys = (): string[] => {
  const rows = getOperationalDb()
    .prepare('SELECT DISTINCT key FROM quests ORDER BY key')
    .all() as Array<{ key: string }>
  return rows.map((row) => row.key)
}

export const getKnownQuestIds = (): number[] => {
  const rows = getOperationalDb()
    .prepare(
      'SELECT DISTINCT quest_id FROM quests WHERE quest_id IS NOT NULL ORDER BY CAST(quest_id AS TEXT)',
    )
    .all() as Array<{ quest_id: number }>
  return rows.map((row) => row.quest_id)
}

export const upsertQuestRewardRecord = (item: Record<string, any>) => {
  getOperationalDb()
    .prepare(
      `
        INSERT OR IGNORE INTO quest_rewards (
          key,
          quest_id,
          title,
          detail,
          category,
          type,
          selections_json,
          material_json,
          bonus_json,
          bouns_count,
          origin
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      item.key,
      item.questId,
      item.title,
      item.detail,
      item.category,
      item.type,
      JSON.stringify(item.selections),
      JSON.stringify(item.material),
      JSON.stringify(item.bonus),
      item.bounsCount,
      item.origin,
    )
}

export const upsertSelectRankRecord = (info: Record<string, any>) => {
  getOperationalDb()
    .prepare(
      `
        INSERT INTO select_rank_records (teitoku_id, maparea_id, teitoku_lv, rank, origin)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(teitoku_id, maparea_id) DO UPDATE SET
          teitoku_lv = excluded.teitoku_lv,
          rank = excluded.rank,
          origin = excluded.origin
      `,
    )
    .run(info.teitokuId, info.mapareaId, info.teitokuLv, info.rank, info.origin)
}

export const upsertRecipeRecord = (info: Record<string, any>, lastReported = Date.now()) => {
  getOperationalDb()
    .prepare(
      `
        INSERT INTO recipe_records (
          recipe_id,
          item_id,
          stage,
          day,
          secretary,
          payload_json,
          last_reported,
          count
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT(recipe_id, item_id, stage, day, secretary) DO UPDATE SET
          payload_json = excluded.payload_json,
          last_reported = excluded.last_reported,
          count = count + 1
      `,
    )
    .run(
      info.recipeId,
      info.itemId,
      info.stage,
      info.day,
      info.secretary,
      JSON.stringify(info),
      lastReported,
    )
}

export const upsertShipStatRecord = (info: Record<string, any>, lastTimestamp = Date.now()) => {
  const key = JSON.stringify({
    asw: info.asw,
    asw_max: info.asw_max,
    evasion: info.evasion,
    evasion_max: info.evasion_max,
    id: info.id,
    los: info.los,
    los_max: info.los_max,
    lv: info.lv,
  })
  getOperationalDb()
    .prepare(
      `
        INSERT INTO ship_stats (stat_key, payload_json, last_timestamp, count)
        VALUES (?, ?, ?, 1)
        ON CONFLICT(stat_key) DO UPDATE SET
          payload_json = excluded.payload_json,
          last_timestamp = excluded.last_timestamp,
          count = count + 1
      `,
    )
    .run(key, JSON.stringify({ ...info, last_timestamp: lastTimestamp }), lastTimestamp)
}

export const upsertEnemyInfoRecord = (info: Record<string, any>) => {
  const key = JSON.stringify({
    equips1: info.equips1,
    equips2: info.equips2,
    hp1: info.hp1,
    hp2: info.hp2,
    levels1: info.levels1,
    levels2: info.levels2,
    planes: info.planes,
    ships1: info.ships1,
    ships2: info.ships2,
    stats1: info.stats1,
    stats2: info.stats2,
  })
  getOperationalDb()
    .prepare(
      `
        INSERT INTO enemy_infos (enemy_key, payload_json, bombers_min, bombers_max, count)
        VALUES (?, ?, ?, ?, 1)
        ON CONFLICT(enemy_key) DO UPDATE SET
          payload_json = excluded.payload_json,
          bombers_min = max(bombers_min, excluded.bombers_min),
          bombers_max = min(bombers_max, excluded.bombers_max),
          count = count + 1
      `,
    )
    .run(key, JSON.stringify(info), info.bombersMin, info.bombersMax)
}

export const insertOperationalRecord = (
  kind: string,
  info: Record<string, any>,
  createdAt = Date.now(),
) => {
  getOperationalDb()
    .prepare(
      `
        INSERT INTO operational_records (kind, payload_json, origin, created_at_ms)
        VALUES (?, ?, ?, ?)
      `,
    )
    .run(kind, JSON.stringify(info), info.origin, createdAt)
}

export const upsertItemImprovementAvailabilityFact = (
  record: ItemImprovementAvailabilityKeyFields & Record<string, any>,
  lastReported = Date.now(),
) => {
  const key = createItemImprovementAvailabilityKey(record)
  const db = getOperationalDb()
  const existing = db
    .prepare(
      'SELECT observed_flagship_ids_json, sources_json FROM item_improvement_availability_facts WHERE key = ?',
    )
    .get(key) as { observed_flagship_ids_json: string; sources_json: string } | undefined
  const observedFlagshipIds = mergeJsonNumberArray(
    existing?.observed_flagship_ids_json,
    record.observedFlagshipIds || [],
  )
  const sources = mergeJsonStringArray(existing?.sources_json, [record.source])
  db.prepare(
    `
        INSERT INTO item_improvement_availability_facts (
          key,
          schema_version,
          recipe_id,
          item_id,
          day,
          observed_second_ship_id,
          observed_flagship_ids_json,
          sources_json,
          first_reported,
          last_reported,
          first_client_observed_at,
          last_client_observed_at,
          count
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT(key) DO UPDATE SET
          observed_flagship_ids_json = excluded.observed_flagship_ids_json,
          sources_json = excluded.sources_json,
          first_client_observed_at = min(first_client_observed_at, excluded.first_client_observed_at),
          last_reported = max(last_reported, excluded.last_reported),
          last_client_observed_at = max(last_client_observed_at, excluded.last_client_observed_at),
          count = count + 1
      `,
  ).run(
    key,
    record.schemaVersion,
    record.recipeId,
    record.itemId,
    record.day,
    record.observedSecondShipId,
    JSON.stringify(observedFlagshipIds),
    JSON.stringify(sources),
    lastReported,
    lastReported,
    record.clientObservedAt,
    record.clientObservedAt,
  )
}

export const upsertItemImprovementCostFact = (
  record: ItemImprovementCostKeyFields & Record<string, any>,
  lastReported = Date.now(),
) => {
  const key = createItemImprovementCostKey(record)
  const db = getOperationalDb()
  const existing = db
    .prepare(
      'SELECT observed_flagship_ids_json, sources_json FROM item_improvement_cost_facts WHERE key = ?',
    )
    .get(key) as { observed_flagship_ids_json: string; sources_json: string } | undefined
  const observedFlagshipIds = mergeJsonNumberArray(
    existing?.observed_flagship_ids_json,
    record.observedFlagshipIds || [],
  )
  const sources = mergeJsonStringArray(existing?.sources_json, [record.source])
  db.prepare(
    `
        INSERT INTO item_improvement_cost_facts (
          key,
          schema_version,
          recipe_id,
          item_id,
          item_level,
          stage,
          day,
          observed_second_ship_id,
          fuel,
          ammo,
          steel,
          bauxite,
          buildkit,
          remodelkit,
          certain_buildkit,
          certain_remodelkit,
          change_flag,
          req_slot_items_json,
          req_use_items_json,
          observed_flagship_ids_json,
          sources_json,
          first_reported,
          last_reported,
          first_client_observed_at,
          last_client_observed_at,
          count
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT(key) DO UPDATE SET
          observed_flagship_ids_json = excluded.observed_flagship_ids_json,
          sources_json = excluded.sources_json,
          first_client_observed_at = min(first_client_observed_at, excluded.first_client_observed_at),
          last_reported = max(last_reported, excluded.last_reported),
          last_client_observed_at = max(last_client_observed_at, excluded.last_client_observed_at),
          count = count + 1
      `,
  ).run(
    key,
    record.schemaVersion,
    record.recipeId,
    record.itemId,
    record.itemLevel,
    record.stage,
    record.day,
    record.observedSecondShipId,
    record.fuel,
    record.ammo,
    record.steel,
    record.bauxite,
    record.buildkit,
    record.remodelkit,
    record.certainBuildkit,
    record.certainRemodelkit,
    record.changeFlag,
    JSON.stringify(record.reqSlotItems || []),
    JSON.stringify(record.reqUseItems || []),
    JSON.stringify(observedFlagshipIds),
    JSON.stringify(sources),
    lastReported,
    lastReported,
    record.clientObservedAt,
    record.clientObservedAt,
  )
}

export const upsertItemImprovementUpdateFact = (
  record: ItemImprovementUpdateKeyFields & Record<string, any>,
  lastReported = Date.now(),
) => {
  const key = createItemImprovementUpdateKey(record)
  const db = getOperationalDb()
  const existing = db
    .prepare(
      'SELECT observed_flagship_ids_json, sources_json FROM item_improvement_update_facts WHERE key = ?',
    )
    .get(key) as { observed_flagship_ids_json: string; sources_json: string } | undefined
  const observedFlagshipIds = mergeJsonNumberArray(
    existing?.observed_flagship_ids_json,
    record.observedFlagshipIds || [],
  )
  const sources = mergeJsonStringArray(existing?.sources_json, [record.source])
  db.prepare(
    `
        INSERT INTO item_improvement_update_facts (
          key,
          schema_version,
          recipe_id,
          item_id,
          item_level,
          day,
          observed_second_ship_id,
          upgrade_to_item_id,
          upgrade_to_item_level,
          upgrade_observed,
          observed_flagship_ids_json,
          sources_json,
          first_reported,
          last_reported,
          first_client_observed_at,
          last_client_observed_at,
          count
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT(key) DO UPDATE SET
          observed_flagship_ids_json = excluded.observed_flagship_ids_json,
          sources_json = excluded.sources_json,
          first_client_observed_at = min(first_client_observed_at, excluded.first_client_observed_at),
          last_reported = max(last_reported, excluded.last_reported),
          last_client_observed_at = max(last_client_observed_at, excluded.last_client_observed_at),
          count = count + 1
      `,
  ).run(
    key,
    record.schemaVersion,
    record.recipeId,
    record.itemId,
    record.itemLevel,
    record.day,
    record.observedSecondShipId,
    record.upgradeToItemId,
    record.upgradeToItemLevel,
    record.upgradeObserved ? 1 : 0,
    JSON.stringify(observedFlagshipIds),
    JSON.stringify(sources),
    lastReported,
    lastReported,
    record.clientObservedAt,
    record.clientObservedAt,
  )
}

interface ExportFactCursor {
  afterId?: string
  limit: number
  updatedAfter: number
}

const parseAfterId = (afterId: string | undefined) => (afterId == null ? 0 : parseInt(afterId, 16))

const getExportCursorPredicate = (afterId: string | undefined) =>
  afterId == null ? 'last_reported > ?' : '(last_reported > ? OR (last_reported = ? AND id > ?))'

const getExportCursorParameters = (cursor: ExportFactCursor) =>
  cursor.afterId == null
    ? [cursor.updatedAfter, cursor.limit]
    : [cursor.updatedAfter, cursor.updatedAfter, parseAfterId(cursor.afterId), cursor.limit]

export const getItemImprovementAvailabilityFacts = ({
  afterId,
  limit,
  updatedAfter,
}: ExportFactCursor) =>
  getOperationalDb()
    .prepare(
      `
        SELECT
          id,
          key,
          schema_version,
          recipe_id,
          item_id,
          day,
          observed_second_ship_id,
          observed_flagship_ids_json,
          sources_json,
          first_reported,
          last_reported,
          first_client_observed_at,
          last_client_observed_at,
          count
        FROM item_improvement_availability_facts
        WHERE ${getExportCursorPredicate(afterId)}
        ORDER BY last_reported, id
        LIMIT ?
      `,
    )
    .all(...getExportCursorParameters({ afterId, limit, updatedAfter })) as Array<{
    count: number
    day: number
    first_client_observed_at: number
    first_reported: number
    id: number
    item_id: number
    key: string
    last_client_observed_at: number
    last_reported: number
    observed_flagship_ids_json: string
    observed_second_ship_id: number
    recipe_id: number
    schema_version: number
    sources_json: string
  }>

export const getItemImprovementCostFacts = (cursor: ExportFactCursor) =>
  getOperationalDb()
    .prepare(
      `
        SELECT *
        FROM item_improvement_cost_facts
        WHERE ${getExportCursorPredicate(cursor.afterId)}
        ORDER BY last_reported, id
        LIMIT ?
      `,
    )
    .all(...getExportCursorParameters(cursor)) as Array<Record<string, any>>

export const getItemImprovementUpdateFacts = (cursor: ExportFactCursor) =>
  getOperationalDb()
    .prepare(
      `
        SELECT *
        FROM item_improvement_update_facts
        WHERE ${getExportCursorPredicate(cursor.afterId)}
        ORDER BY last_reported, id
        LIMIT ?
      `,
    )
    .all(...getExportCursorParameters(cursor)) as Array<Record<string, any>>

const countRows = (table: string) =>
  (
    getOperationalDb().prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
      count: number
    }
  ).count

const countOperationalRecords = (kind: string) =>
  (
    getOperationalDb()
      .prepare('SELECT COUNT(*) AS count FROM operational_records WHERE kind = ?')
      .get(kind) as { count: number }
  ).count

export const getOperationalSqliteCounts = (): Record<string, number> => ({
  BattleAPI: countOperationalRecords('battle_api'),
  EnemyInfo: countRows('enemy_infos'),
  PassEventRecord: countOperationalRecords('pass_event'),
  Quest: countRows('quests'),
  QuestReward: countRows('quest_rewards'),
  RecipeRecord: countRows('recipe_records'),
  RemodelItemRecord: countOperationalRecords('remodel_item'),
  SelectRankRecord: countRows('select_rank_records'),
  ShipStat: countRows('ship_stats'),
})
