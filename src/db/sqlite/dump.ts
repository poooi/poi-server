import Database from 'better-sqlite3'
import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import zlib from 'zlib'

interface ExportAppendOnlyMonthOptions {
  appendOnlyDir: string
  month: string
  outputDir: string
}

interface TableDumpResult {
  count: number
  sha256: string
}

export interface AppendOnlyDumpResult {
  filePath: string
  fileSha256: string
  month: string
  tables: Record<string, TableDumpResult>
}

interface RemoveValidatedAppendOnlyMonthOptions {
  appendOnlyDir: string
  dump: AppendOnlyDumpResult
}

const sha256 = (value: string | Buffer) => crypto.createHash('sha256').update(value).digest('hex')

const createTableResult = (records: unknown[]): TableDumpResult => ({
  count: records.length,
  sha256: sha256(JSON.stringify(records)),
})

const assertMonth = (month: string) => {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error('Month must use YYYY-MM format')
  }
}

export const exportAppendOnlyMonth = async ({
  appendOnlyDir,
  month,
  outputDir,
}: ExportAppendOnlyMonthOptions): Promise<AppendOnlyDumpResult> => {
  assertMonth(month)
  const sqlitePath = path.join(appendOnlyDir, `append-only-${month}.sqlite`)
  const db = new Database(sqlitePath, { readonly: true })
  try {
    const createitemrecords = db
      .prepare(
        `
          SELECT public_id, items_json, secretary, item_id, teitoku_lv, successful, origin
          FROM create_item_records
          ORDER BY id
        `,
      )
      .all() as Array<{
      item_id: number
      items_json: string
      origin: string
      public_id: string
      secretary: number
      successful: number
      teitoku_lv: number
    }>
    const createshiprecords = db
      .prepare(
        `
          SELECT public_id, items_json, kdock_id, secretary, ship_id, highspeed, teitoku_lv, large_flag, origin
          FROM create_ship_records
          ORDER BY id
        `,
      )
      .all() as Array<{
      highspeed: number
      items_json: string
      kdock_id: number
      large_flag: number
      origin: string
      public_id: string
      secretary: number
      ship_id: number
      teitoku_lv: number
    }>
    const dropshiprecords = db
      .prepare(
        `
          SELECT public_id, ship_id, item_id, map_id, quest, cell_id, enemy, rank, is_boss, teitoku_lv, map_lv, enemy_ships1_json, enemy_ships2_json, enemy_formation, base_exp, teitoku_id, ship_counts_json, owned_ship_snapshot_json, origin
          FROM drop_ship_records
          ORDER BY id
        `,
      )
      .all() as Array<{
      base_exp: number
      cell_id: number
      enemy: string
      enemy_formation: number
      enemy_ships1_json: string
      enemy_ships2_json: string
      is_boss: number
      item_id: number
      map_id: number
      map_lv: number
      origin: string
      owned_ship_snapshot_json: string
      public_id: string
      quest: string
      rank: string
      ship_counts_json: string
      ship_id: number
      teitoku_id: string
      teitoku_lv: number
    }>
    const nightcontactrecords = db
      .prepare(
        `
          SELECT public_id, fleet_type, ship_id, ship_lv, item_id, item_lv, contact
          FROM night_contact_records
          ORDER BY id
        `,
      )
      .all() as Array<{
      contact: number
      fleet_type: number
      item_id: number
      item_lv: number
      public_id: string
      ship_id: number
      ship_lv: number
    }>
    const aacirecords = db
      .prepare(
        `
          SELECT public_id, poi_version, available_json, triggered, items_json, improvement_json, raw_luck, raw_taiku, lv, hp_percent, pos, origin
          FROM aaci_records
          ORDER BY id
        `,
      )
      .all() as Array<{
      available_json: string
      hp_percent: number
      improvement_json: string
      items_json: string
      lv: number
      origin: string
      poi_version: string
      pos: number
      public_id: string
      raw_luck: number
      raw_taiku: number
      triggered: number
    }>
    const dump = {
      aacirecords: aacirecords.map((row) => ({
        _id: row.public_id,
        available: JSON.parse(row.available_json),
        hpPercent: row.hp_percent,
        improvement: JSON.parse(row.improvement_json),
        items: JSON.parse(row.items_json),
        lv: row.lv,
        origin: row.origin,
        poiVersion: row.poi_version,
        pos: row.pos,
        rawLuck: row.raw_luck,
        rawTaiku: row.raw_taiku,
        triggered: row.triggered,
      })),
      createitemrecords: createitemrecords.map((row) => ({
        _id: row.public_id,
        itemId: row.item_id,
        items: JSON.parse(row.items_json),
        origin: row.origin,
        secretary: row.secretary,
        successful: Boolean(row.successful),
        teitokuLv: row.teitoku_lv,
      })),
      createshiprecords: createshiprecords.map((row) => ({
        _id: row.public_id,
        highspeed: row.highspeed,
        items: JSON.parse(row.items_json),
        kdockId: row.kdock_id,
        largeFlag: Boolean(row.large_flag),
        origin: row.origin,
        secretary: row.secretary,
        shipId: row.ship_id,
        teitokuLv: row.teitoku_lv,
      })),
      dropshiprecords: dropshiprecords.map((row) => ({
        _id: row.public_id,
        baseExp: row.base_exp,
        cellId: row.cell_id,
        enemy: row.enemy,
        enemyFormation: row.enemy_formation,
        enemyShips1: JSON.parse(row.enemy_ships1_json),
        enemyShips2: JSON.parse(row.enemy_ships2_json),
        isBoss: Boolean(row.is_boss),
        itemId: row.item_id,
        mapId: row.map_id,
        mapLv: row.map_lv,
        origin: row.origin,
        ownedShipSnapshot: JSON.parse(row.owned_ship_snapshot_json),
        quest: row.quest,
        rank: row.rank,
        shipCounts: JSON.parse(row.ship_counts_json),
        shipId: row.ship_id,
        teitokuId: row.teitoku_id,
        teitokuLv: row.teitoku_lv,
      })),
      nightcontactrecords: nightcontactrecords.map((row) => ({
        _id: row.public_id,
        contact: Boolean(row.contact),
        fleetType: row.fleet_type,
        itemId: row.item_id,
        itemLv: row.item_lv,
        shipId: row.ship_id,
        shipLv: row.ship_lv,
      })),
    }
    const json = JSON.stringify(dump)
    const gzip = zlib.gzipSync(json)
    await fs.mkdir(outputDir, { recursive: true })
    const filePath = path.join(outputDir, `append-only-${month}.json.gz`)
    await fs.writeFile(filePath, gzip)

    return {
      filePath,
      fileSha256: sha256(gzip),
      month,
      tables: {
        aacirecords: createTableResult(dump.aacirecords),
        createitemrecords: createTableResult(dump.createitemrecords),
        createshiprecords: createTableResult(dump.createshiprecords),
        dropshiprecords: createTableResult(dump.dropshiprecords),
        nightcontactrecords: createTableResult(dump.nightcontactrecords),
      },
    }
  } finally {
    db.close()
  }
}

export const removeValidatedAppendOnlyMonth = async ({
  appendOnlyDir,
  dump,
}: RemoveValidatedAppendOnlyMonthOptions): Promise<void> => {
  assertMonth(dump.month)
  if (!/^[a-f0-9]{64}$/.test(dump.fileSha256)) {
    throw new Error('Refusing to remove append-only SQLite file without a valid dump checksum')
  }
  const sqlitePath = path.join(appendOnlyDir, `append-only-${dump.month}.sqlite`)
  await fs.rm(sqlitePath)
}
