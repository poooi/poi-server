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

export const exportAppendOnlyMonth = async ({
  appendOnlyDir,
  month,
  outputDir,
}: ExportAppendOnlyMonthOptions): Promise<AppendOnlyDumpResult> => {
  const sqlitePath = path.join(appendOnlyDir, `append-only-${month}.sqlite`)
  const db = new Database(sqlitePath, { readonly: true })
  try {
    const createitemrecords = db
      .prepare(
        `
          SELECT item_id, origin
          FROM create_item_records
          ORDER BY id
        `,
      )
      .all() as Array<{ item_id: number; origin: string }>
    const createshiprecords = db
      .prepare(
        `
          SELECT ship_id
          FROM create_ship_records
          ORDER BY id
        `,
      )
      .all() as Array<{ ship_id: number }>
    const dropshiprecords = db
      .prepare(
        `
          SELECT map_id, owned_ship_snapshot_json
          FROM drop_ship_records
          ORDER BY id
        `,
      )
      .all() as Array<{ map_id: number; owned_ship_snapshot_json: string }>
    const nightcontactrecords = db
      .prepare(
        `
          SELECT contact
          FROM night_contact_records
          ORDER BY id
        `,
      )
      .all() as Array<{ contact: number }>
    const aacirecords = db
      .prepare(
        `
          SELECT poi_version
          FROM aaci_records
          ORDER BY id
        `,
      )
      .all() as Array<{ poi_version: string }>
    const dump = {
      aacirecords: aacirecords.map((row) => ({
        poiVersion: row.poi_version,
      })),
      createitemrecords: createitemrecords.map((row) => ({
        itemId: row.item_id,
        origin: row.origin,
      })),
      createshiprecords: createshiprecords.map((row) => ({
        shipId: row.ship_id,
      })),
      dropshiprecords: dropshiprecords.map((row) => ({
        mapId: row.map_id,
        ownedShipSnapshot: JSON.parse(row.owned_ship_snapshot_json),
      })),
      nightcontactrecords: nightcontactrecords.map((row) => ({
        contact: Boolean(row.contact),
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
  if (!/^[a-f0-9]{64}$/.test(dump.fileSha256)) {
    throw new Error('Refusing to remove append-only SQLite file without a valid dump checksum')
  }
  const sqlitePath = path.join(appendOnlyDir, `append-only-${dump.month}.sqlite`)
  await fs.rm(sqlitePath)
}
