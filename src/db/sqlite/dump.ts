import Database from 'better-sqlite3'
import crypto from 'crypto'
import { once } from 'events'
import fs from 'fs'
import fsPromises from 'fs/promises'
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
  now?: number
}

const getUtcMonth = (time: number) => new Date(time).toISOString().slice(0, 7)

const assertMonth = (month: string) => {
  const match = /^(\d{4})-(\d{2})$/.exec(month)
  if (match == null) {
    throw new Error('Month must use YYYY-MM format')
  }
  const parsedMonth = parseInt(match[2], 10)
  if (parsedMonth < 1 || parsedMonth > 12) {
    throw new Error('Month must use YYYY-MM format')
  }
}

const writeGzip = async (gzip: zlib.Gzip, text: string) => {
  if (!gzip.write(text)) {
    await once(gzip, 'drain')
  }
}

const writeTable = async <TRow>({
  gzip,
  includeComma,
  name,
  rows,
  serialize,
}: {
  gzip: zlib.Gzip
  includeComma: boolean
  name: string
  rows: Iterable<TRow>
  serialize: (row: TRow) => Record<string, unknown>
}): Promise<TableDumpResult> => {
  const tableHash = crypto.createHash('sha256')
  let count = 0
  await writeGzip(gzip, `${includeComma ? ',' : ''}"${name}":[`)
  for (const row of rows) {
    const json = JSON.stringify(serialize(row))
    tableHash.update(json)
    await writeGzip(gzip, `${count === 0 ? '' : ','}${json}`)
    count += 1
  }
  await writeGzip(gzip, ']')
  return {
    count,
    sha256: tableHash.digest('hex'),
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
  await fsPromises.mkdir(outputDir, { recursive: true })
  const filePath = path.join(outputDir, `append-only-${month}.json.gz`)
  const output = fs.createWriteStream(filePath)
  const gzip = zlib.createGzip()
  const fileHash = crypto.createHash('sha256')
  const tables: Record<string, TableDumpResult> = {}
  gzip.on('data', (chunk: Buffer) => fileHash.update(chunk))
  gzip.pipe(output)

  try {
    await writeGzip(gzip, '{')
    tables.aacirecords = await writeTable({
      gzip,
      includeComma: false,
      name: 'aacirecords',
      rows: db
        .prepare(
          'SELECT public_id, poi_version, available_json, triggered, items_json, improvement_json, raw_luck, raw_taiku, lv, hp_percent, pos, origin FROM aaci_records ORDER BY id',
        )
        .iterate() as Iterable<Record<string, any>>,
      serialize: (row) => ({
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
      }),
    })
    tables.createitemrecords = await writeTable({
      gzip,
      includeComma: true,
      name: 'createitemrecords',
      rows: db
        .prepare(
          'SELECT public_id, items_json, secretary, item_id, teitoku_lv, successful, origin FROM create_item_records ORDER BY id',
        )
        .iterate() as Iterable<Record<string, any>>,
      serialize: (row) => ({
        _id: row.public_id,
        itemId: row.item_id,
        items: JSON.parse(row.items_json),
        origin: row.origin,
        secretary: row.secretary,
        successful: Boolean(row.successful),
        teitokuLv: row.teitoku_lv,
      }),
    })
    tables.createshiprecords = await writeTable({
      gzip,
      includeComma: true,
      name: 'createshiprecords',
      rows: db
        .prepare(
          'SELECT public_id, items_json, kdock_id, secretary, ship_id, highspeed, teitoku_lv, large_flag, origin FROM create_ship_records ORDER BY id',
        )
        .iterate() as Iterable<Record<string, any>>,
      serialize: (row) => ({
        _id: row.public_id,
        highspeed: row.highspeed,
        items: JSON.parse(row.items_json),
        kdockId: row.kdock_id,
        largeFlag: Boolean(row.large_flag),
        origin: row.origin,
        secretary: row.secretary,
        shipId: row.ship_id,
        teitokuLv: row.teitoku_lv,
      }),
    })
    tables.dropshiprecords = await writeTable({
      gzip,
      includeComma: true,
      name: 'dropshiprecords',
      rows: db
        .prepare(
          'SELECT public_id, ship_id, item_id, map_id, quest, cell_id, enemy, rank, is_boss, teitoku_lv, map_lv, enemy_ships1_json, enemy_ships2_json, enemy_formation, base_exp, teitoku_id, ship_counts_json, owned_ship_snapshot_json, origin FROM drop_ship_records ORDER BY id',
        )
        .iterate() as Iterable<Record<string, any>>,
      serialize: (row) => ({
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
      }),
    })
    tables.nightcontactrecords = await writeTable({
      gzip,
      includeComma: true,
      name: 'nightcontactrecords',
      rows: db
        .prepare(
          'SELECT public_id, fleet_type, ship_id, ship_lv, item_id, item_lv, contact FROM night_contact_records ORDER BY id',
        )
        .iterate() as Iterable<Record<string, any>>,
      serialize: (row) => ({
        _id: row.public_id,
        contact: Boolean(row.contact),
        fleetType: row.fleet_type,
        itemId: row.item_id,
        itemLv: row.item_lv,
        shipId: row.ship_id,
        shipLv: row.ship_lv,
      }),
    })
    await writeGzip(gzip, '}')
    gzip.end()
    await once(output, 'finish')
    return {
      filePath,
      fileSha256: fileHash.digest('hex'),
      month,
      tables,
    }
  } finally {
    db.close()
  }
}

export const removeValidatedAppendOnlyMonth = async ({
  appendOnlyDir,
  dump,
  now = Date.now(),
}: RemoveValidatedAppendOnlyMonthOptions): Promise<void> => {
  assertMonth(dump.month)
  if (!/^[a-f0-9]{64}$/.test(dump.fileSha256)) {
    throw new Error('Refusing to remove append-only SQLite file without a valid dump checksum')
  }
  if (dump.month >= getUtcMonth(now)) {
    throw new Error('Refusing to remove the active append-only SQLite month')
  }
  const sqlitePath = path.join(appendOnlyDir, `append-only-${dump.month}.sqlite`)
  await fsPromises.rm(sqlitePath)
}
