import Database from 'better-sqlite3'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { runSqliteWrite } from './write-queue'

interface AppendOnlyState {
  appendOnlyDir: string
  handles: Map<string, Database.Database>
}

const state: AppendOnlyState = {
  appendOnlyDir: '',
  handles: new Map(),
}

const sqlitePrefix = 'sqlite://'

const stripSqlitePrefix = (db: string) =>
  db.startsWith(sqlitePrefix) ? db.slice(sqlitePrefix.length) : db

const getUtcMonth = (time: number) => new Date(time).toISOString().slice(0, 7)

const createPublicId = (time: number) => {
  const timestamp = Math.floor(time / 1000)
    .toString(16)
    .padStart(8, '0')
  return `${timestamp}${crypto.randomBytes(8).toString('hex')}`
}

const ensureAppendOnlySchema = (db: Database.Database) => {
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('busy_timeout = 5000')
  db.exec(`
    CREATE TABLE IF NOT EXISTS create_item_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL UNIQUE,
      received_at_ms INTEGER NOT NULL,
      items_json TEXT NOT NULL,
      secretary INTEGER,
      item_id INTEGER,
      teitoku_lv INTEGER,
      successful INTEGER NOT NULL,
      origin TEXT
    );

    CREATE TABLE IF NOT EXISTS create_ship_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL UNIQUE,
      received_at_ms INTEGER NOT NULL,
      items_json TEXT NOT NULL,
      kdock_id INTEGER,
      secretary INTEGER,
      ship_id INTEGER,
      highspeed INTEGER,
      teitoku_lv INTEGER,
      large_flag INTEGER NOT NULL,
      origin TEXT
    );

    CREATE TABLE IF NOT EXISTS drop_ship_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL UNIQUE,
      received_at_ms INTEGER NOT NULL,
      ship_id INTEGER,
      item_id INTEGER,
      map_id INTEGER,
      quest TEXT,
      cell_id INTEGER,
      enemy TEXT,
      rank TEXT,
      is_boss INTEGER NOT NULL,
      teitoku_lv INTEGER,
      map_lv INTEGER,
      enemy_ships1_json TEXT NOT NULL,
      enemy_ships2_json TEXT NOT NULL,
      enemy_formation INTEGER,
      base_exp INTEGER,
      teitoku_id TEXT,
      ship_counts_json TEXT NOT NULL,
      owned_ship_snapshot_json TEXT NOT NULL,
      origin TEXT
    );

    CREATE TABLE IF NOT EXISTS night_contact_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL UNIQUE,
      received_at_ms INTEGER NOT NULL,
      fleet_type INTEGER,
      ship_id INTEGER,
      ship_lv INTEGER,
      item_id INTEGER,
      item_lv INTEGER,
      contact INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS aaci_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL UNIQUE,
      received_at_ms INTEGER NOT NULL,
      poi_version TEXT,
      available_json TEXT NOT NULL,
      triggered INTEGER,
      items_json TEXT NOT NULL,
      improvement_json TEXT NOT NULL,
      raw_luck INTEGER,
      raw_taiku INTEGER,
      lv INTEGER,
      hp_percent INTEGER,
      pos INTEGER,
      origin TEXT
    );
  `)
}

const getAppendOnlyDatabase = (month: string) => {
  const existing = state.handles.get(month)
  if (existing != null) {
    return existing
  }

  if (state.appendOnlyDir === '') {
    throw new Error('SQLite append-only directory is not configured')
  }

  fs.mkdirSync(state.appendOnlyDir, { recursive: true })
  const db = new Database(path.join(state.appendOnlyDir, `append-only-${month}.sqlite`))
  ensureAppendOnlySchema(db)
  state.handles.set(month, db)
  return db
}

const countTable = (db: Database.Database, table: string) =>
  (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count

export const initializeSqliteAppendOnlyStorage = (operationalDb: string) => {
  closeSqliteAppendOnlyStorage()
  const operationalPath = stripSqlitePrefix(operationalDb)
  state.appendOnlyDir =
    process.env.POI_SERVER_SQLITE_APPEND_ONLY_DIR ||
    path.join(path.dirname(operationalPath), 'append-only')
}

export const closeSqliteAppendOnlyStorage = () => {
  for (const db of state.handles.values()) {
    db.close()
  }
  state.handles.clear()
}

export const insertCreateItemRecord = (info: Record<string, any>, receivedAt = Date.now()) =>
  runSqliteWrite(`append-only:${getUtcMonth(receivedAt)}`, () => {
    const month = getUtcMonth(receivedAt)
    const db = getAppendOnlyDatabase(month)
    db.prepare(
      `
      INSERT INTO create_item_records (
        public_id,
        received_at_ms,
        items_json,
        secretary,
        item_id,
        teitoku_lv,
        successful,
        origin
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      createPublicId(receivedAt),
      receivedAt,
      JSON.stringify(info.items),
      info.secretary,
      info.itemId,
      info.teitokuLv,
      info.successful ? 1 : 0,
      info.origin,
    )
  })

export const insertCreateShipRecord = (info: Record<string, any>, receivedAt = Date.now()) =>
  runSqliteWrite(`append-only:${getUtcMonth(receivedAt)}`, () => {
    const month = getUtcMonth(receivedAt)
    const db = getAppendOnlyDatabase(month)
    db.prepare(
      `
      INSERT INTO create_ship_records (
        public_id,
        received_at_ms,
        items_json,
        kdock_id,
        secretary,
        ship_id,
        highspeed,
        teitoku_lv,
        large_flag,
        origin
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      createPublicId(receivedAt),
      receivedAt,
      JSON.stringify(info.items),
      info.kdockId,
      info.secretary,
      info.shipId,
      info.highspeed,
      info.teitokuLv,
      info.largeFlag ? 1 : 0,
      info.origin,
    )
  })

export const insertDropShipRecord = (info: Record<string, any>, receivedAt = Date.now()) =>
  runSqliteWrite(`append-only:${getUtcMonth(receivedAt)}`, () => {
    const month = getUtcMonth(receivedAt)
    const db = getAppendOnlyDatabase(month)
    const ownedShipSnapshot = info.mapId < 73 ? {} : info.ownedShipSnapshot
    db.prepare(
      `
      INSERT INTO drop_ship_records (
        public_id,
        received_at_ms,
        ship_id,
        item_id,
        map_id,
        quest,
        cell_id,
        enemy,
        rank,
        is_boss,
        teitoku_lv,
        map_lv,
        enemy_ships1_json,
        enemy_ships2_json,
        enemy_formation,
        base_exp,
        teitoku_id,
        ship_counts_json,
        owned_ship_snapshot_json,
        origin
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      createPublicId(receivedAt),
      receivedAt,
      info.shipId,
      info.itemId,
      info.mapId,
      info.quest,
      info.cellId,
      info.enemy,
      info.rank,
      info.isBoss ? 1 : 0,
      info.teitokuLv,
      info.mapLv,
      JSON.stringify(info.enemyShips1),
      JSON.stringify(info.enemyShips2),
      info.enemyFormation,
      info.baseExp,
      info.teitokuId,
      JSON.stringify(info.shipCounts),
      JSON.stringify(ownedShipSnapshot),
      info.origin,
    )
  })

export const insertNightContactRecord = (info: Record<string, any>, receivedAt = Date.now()) =>
  runSqliteWrite(`append-only:${getUtcMonth(receivedAt)}`, () => {
    const month = getUtcMonth(receivedAt)
    const db = getAppendOnlyDatabase(month)
    db.prepare(
      `
      INSERT INTO night_contact_records (
        public_id,
        received_at_ms,
        fleet_type,
        ship_id,
        ship_lv,
        item_id,
        item_lv,
        contact
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      createPublicId(receivedAt),
      receivedAt,
      info.fleetType,
      info.shipId,
      info.shipLv,
      info.itemId,
      info.itemLv,
      info.contact ? 1 : 0,
    )
  })

export const insertAACIRecord = (info: Record<string, any>, receivedAt = Date.now()) =>
  runSqliteWrite(`append-only:${getUtcMonth(receivedAt)}`, () => {
    const month = getUtcMonth(receivedAt)
    const db = getAppendOnlyDatabase(month)
    db.prepare(
      `
      INSERT INTO aaci_records (
        public_id,
        received_at_ms,
        poi_version,
        available_json,
        triggered,
        items_json,
        improvement_json,
        raw_luck,
        raw_taiku,
        lv,
        hp_percent,
        pos,
        origin
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      createPublicId(receivedAt),
      receivedAt,
      info.poiVersion,
      JSON.stringify(info.available),
      info.triggered,
      JSON.stringify(info.items),
      JSON.stringify(info.improvement),
      info.rawLuck,
      info.rawTaiku,
      info.lv,
      info.hpPercent,
      info.pos,
      info.origin,
    )
  })

export const getAppendOnlySqliteCounts = (): Record<string, number> => {
  const counts = {
    AACIRecord: 0,
    CreateItemRecord: 0,
    CreateShipRecord: 0,
    DropShipRecord: 0,
    NightContactRecord: 0,
  }
  const countedFiles = new Set<string>()
  const addCounts = (db: Database.Database) => {
    counts.AACIRecord += countTable(db, 'aaci_records')
    counts.CreateItemRecord += countTable(db, 'create_item_records')
    counts.CreateShipRecord += countTable(db, 'create_ship_records')
    counts.DropShipRecord += countTable(db, 'drop_ship_records')
    counts.NightContactRecord += countTable(db, 'night_contact_records')
  }

  for (const [month, db] of state.handles.entries()) {
    countedFiles.add(path.join(state.appendOnlyDir, `append-only-${month}.sqlite`))
    addCounts(db)
  }

  if (state.appendOnlyDir !== '' && fs.existsSync(state.appendOnlyDir)) {
    for (const fileName of fs.readdirSync(state.appendOnlyDir)) {
      if (!/^append-only-\d{4}-\d{2}\.sqlite$/.test(fileName)) {
        continue
      }
      const filePath = path.join(state.appendOnlyDir, fileName)
      if (countedFiles.has(filePath)) {
        continue
      }
      const db = new Database(filePath, { readonly: true })
      try {
        addCounts(db)
      } finally {
        db.close()
      }
    }
  }
  return counts
}
