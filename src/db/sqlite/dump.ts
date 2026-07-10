import Database from 'better-sqlite3'
import crypto from 'crypto'
import { once } from 'events'
import fs from 'fs'
import fsPromises from 'fs/promises'
import path from 'path'
import { finished, pipeline } from 'stream/promises'
import zlib from 'zlib'
import { z } from 'zod'
import { acquireAppendOnlyMonthLock, acquireDumpPublicationLock } from './month-lock'

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
  manifestFileSha256: string
  manifestPath: string
  month: string
  sourceFileSha256: string
  tables: Record<string, TableDumpResult>
}

interface AppendOnlyDumpManifest {
  artifactFileName: string
  fileSha256: string
  month: string
  sourceFileName: string
  sourceFileSha256: string
  tables: Record<string, TableDumpResult>
  version: 1
}

interface RemoveManifestValidatedAppendOnlyMonthOptions {
  appendOnlyDir: string
  manifestPath: string
  now?: number
  verifiedManifestSha256: string
}

const getUtcMonth = (time: number) => new Date(time).toISOString().slice(0, 7)

const getPreviousUtcMonth = (time: number) => {
  const date = new Date(time)
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1))
    .toISOString()
    .slice(0, 7)
}

const isRolloverGraceDay = (time: number) => new Date(time).getUTCDate() === 1

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
const tableDumpResultSchema = z.object({
  count: z.number().int().nonnegative(),
  sha256: sha256Schema,
})
const appendOnlyDumpManifestSchema = z
  .object({
    artifactFileName: z.string().min(1),
    fileSha256: sha256Schema,
    month: z.string(),
    sourceFileName: z.string().min(1),
    sourceFileSha256: sha256Schema,
    tables: z.record(z.string(), tableDumpResultSchema),
    version: z.literal(1),
  })
  .strict()

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

const assertInactiveMonth = (month: string, now: number, action: 'export' | 'remove') => {
  if (
    month >= getUtcMonth(now) ||
    (isRolloverGraceDay(now) && month === getPreviousUtcMonth(now))
  ) {
    throw new Error(
      action === 'export'
        ? 'Refusing to export an active append-only SQLite month'
        : 'Refusing to remove the active append-only SQLite month',
    )
  }
}

const writeGzip = async (gzip: zlib.Gzip, streamFailure: Promise<never>, text: string) => {
  if (!gzip.write(text)) {
    await Promise.race([once(gzip, 'drain'), streamFailure])
  }
}

const computeFileSha256 = async (filePath: string) => {
  const input = fs.createReadStream(filePath)
  const hash = crypto.createHash('sha256')
  input.on('data', (chunk: Buffer) => hash.update(chunk))
  await finished(input)
  return hash.digest('hex')
}

const computeBufferSha256 = (content: Buffer) =>
  crypto.createHash('sha256').update(content).digest('hex')

const fileExists = async (filePath: string) => {
  try {
    await fsPromises.access(filePath)
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return false
    }
    throw err
  }
}

const writeTable = async <TRow>({
  gzip,
  includeComma,
  name,
  rows,
  serialize,
  streamFailure,
}: {
  gzip: zlib.Gzip
  includeComma: boolean
  name: string
  rows: Iterable<TRow>
  serialize: (row: TRow) => Record<string, unknown>
  streamFailure: Promise<never>
}): Promise<TableDumpResult> => {
  const tableHash = crypto.createHash('sha256')
  let count = 0
  await writeGzip(gzip, streamFailure, `${includeComma ? ',' : ''}"${name}":[`)
  for (const row of rows) {
    const json = JSON.stringify(serialize(row))
    tableHash.update(`${json.length}:${json}`)
    await writeGzip(gzip, streamFailure, `${count === 0 ? '' : ','}${json}`)
    count += 1
  }
  await writeGzip(gzip, streamFailure, ']')
  return {
    count,
    sha256: tableHash.digest('hex'),
  }
}

const assertExistingOutputCompatible = async (finalPath: string, expectedSha256: string) => {
  if ((await fileExists(finalPath)) && (await computeFileSha256(finalPath)) !== expectedSha256) {
    throw new Error(`Refusing to replace an existing dump output: ${path.basename(finalPath)}`)
  }
}

const publishTemporaryFile = async (
  temporaryPath: string,
  finalPath: string,
  expectedSha256: string,
) => {
  if (await fileExists(finalPath)) {
    if ((await computeFileSha256(finalPath)) !== expectedSha256) {
      throw new Error(`Refusing to replace an existing dump output: ${path.basename(finalPath)}`)
    }
    await fsPromises.rm(temporaryPath, { force: true })
    return
  }

  try {
    await fsPromises.link(temporaryPath, finalPath)
    await fsPromises.rm(temporaryPath, { force: true })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST' || !(await fileExists(finalPath))) {
      throw err
    }
    if ((await computeFileSha256(finalPath)) !== expectedSha256) {
      throw new Error(`Refusing to replace an existing dump output: ${path.basename(finalPath)}`)
    }
    await fsPromises.rm(temporaryPath, { force: true })
  }
}

const removeStaleTemporaryOutputs = async (outputDir: string, month: string) => {
  const prefixes = [`append-only-${month}.json.gz.tmp-`, `append-only-${month}.manifest.json.tmp-`]
  for (const fileName of await fsPromises.readdir(outputDir)) {
    if (prefixes.some((prefix) => fileName.startsWith(prefix))) {
      await fsPromises.rm(path.join(outputDir, fileName), { force: true })
    }
  }
}

export const exportAppendOnlyMonth = async ({
  appendOnlyDir,
  month,
  outputDir,
}: ExportAppendOnlyMonthOptions): Promise<AppendOnlyDumpResult> => {
  assertMonth(month)
  assertInactiveMonth(month, Date.now(), 'export')
  await fsPromises.mkdir(outputDir, { recursive: true })
  const monthLock = acquireAppendOnlyMonthLock(appendOnlyDir, month)
  let publicationLock: ReturnType<typeof acquireDumpPublicationLock> | undefined
  const sqlitePath = path.join(appendOnlyDir, `append-only-${month}.sqlite`)
  let db: Database.Database | undefined
  const filePath = path.join(outputDir, `append-only-${month}.json.gz`)
  const manifestPath = path.join(outputDir, `append-only-${month}.manifest.json`)
  const temporarySuffix = `.tmp-${process.pid}-${crypto.randomUUID()}`
  const temporaryFilePath = `${filePath}${temporarySuffix}`
  const temporaryManifestPath = `${manifestPath}${temporarySuffix}`
  let output: fs.WriteStream | undefined
  let gzip: zlib.Gzip | undefined
  let pipelinePromise: Promise<void> | undefined
  const fileHash = crypto.createHash('sha256')
  const tables: Record<string, TableDumpResult> = {}
  let completed = false

  try {
    publicationLock = acquireDumpPublicationLock(outputDir, month)
    await removeStaleTemporaryOutputs(outputDir, month)
    if (!(await fileExists(sqlitePath))) {
      throw new Error(`Append-only SQLite month ${month} does not exist`)
    }
    db = new Database(sqlitePath)
    db.pragma('busy_timeout = 1000')
    const checkpoint = db.pragma('wal_checkpoint(TRUNCATE)') as Array<{
      busy: number
      checkpointed: number
      log: number
    }>
    if (
      checkpoint.length !== 1 ||
      checkpoint[0].busy !== 0 ||
      checkpoint[0].log !== checkpoint[0].checkpointed
    ) {
      throw new Error(`Unable to checkpoint append-only SQLite month ${month}`)
    }
    output = fs.createWriteStream(temporaryFilePath)
    gzip = zlib.createGzip()
    let rejectStream: (err: Error) => void
    const streamFailure = new Promise<never>((_resolve, reject) => {
      rejectStream = reject
    })
    void streamFailure.catch(() => undefined)
    gzip.once('error', rejectStream!)
    output.once('error', rejectStream!)
    gzip.on('data', (chunk: Buffer) => fileHash.update(chunk))
    pipelinePromise = pipeline(gzip, output)
    await writeGzip(gzip, streamFailure, '{')
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
      streamFailure,
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
      streamFailure,
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
      streamFailure,
    })
    tables.dropshiprecords = await writeTable({
      gzip,
      includeComma: true,
      name: 'dropshiprecords',
      rows: db
        .prepare(
          'SELECT public_id, ship_id, item_id, map_id, quest, cell_id, enemy, rank, is_boss, teitoku_lv, map_lv, enemy_ships1_json, enemy_ships2_json, enemy_formation, base_exp, teitoku_id, owned_ship_snapshot_json, origin FROM drop_ship_records ORDER BY id',
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
        shipId: row.ship_id,
        teitokuId: row.teitoku_id,
        teitokuLv: row.teitoku_lv,
      }),
      streamFailure,
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
      streamFailure,
    })
    await writeGzip(gzip, streamFailure, '}')
    gzip.end()
    await pipelinePromise
    db.close()
    db = undefined
    const sourceFileSha256 = await computeFileSha256(sqlitePath)
    const fileSha256 = fileHash.digest('hex')
    const manifest: AppendOnlyDumpManifest = {
      artifactFileName: path.basename(filePath),
      fileSha256,
      month,
      sourceFileName: path.basename(sqlitePath),
      sourceFileSha256,
      tables,
      version: 1,
    }
    await fsPromises.writeFile(
      temporaryManifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    )
    const manifestFileSha256 = await computeFileSha256(temporaryManifestPath)
    await assertExistingOutputCompatible(filePath, fileSha256)
    await assertExistingOutputCompatible(manifestPath, manifestFileSha256)
    await publishTemporaryFile(temporaryFilePath, filePath, fileSha256)
    await publishTemporaryFile(temporaryManifestPath, manifestPath, manifestFileSha256)
    completed = true
    return {
      filePath,
      fileSha256,
      manifestFileSha256,
      manifestPath,
      month,
      sourceFileSha256,
      tables,
    }
  } finally {
    if (!completed) {
      gzip?.destroy()
      output?.destroy()
      await pipelinePromise?.catch(() => undefined)
      await fsPromises.rm(temporaryFilePath, { force: true }).catch(() => undefined)
      await fsPromises.rm(temporaryManifestPath, { force: true }).catch(() => undefined)
    }
    db?.close()
    try {
      publicationLock?.release()
    } finally {
      monthLock.release()
    }
  }
}

export const removeManifestValidatedAppendOnlyMonth = async ({
  appendOnlyDir,
  manifestPath,
  now = Date.now(),
  verifiedManifestSha256,
}: RemoveManifestValidatedAppendOnlyMonthOptions): Promise<AppendOnlyDumpResult> => {
  if (!sha256Schema.safeParse(verifiedManifestSha256).success) {
    throw new Error('Cleanup requires a valid externally verified manifest checksum')
  }

  const readVerifiedManifest = async () => {
    const content = await fsPromises.readFile(manifestPath)
    if (computeBufferSha256(content) !== verifiedManifestSha256) {
      throw new Error('Refusing cleanup because the verified manifest checksum does not match')
    }
    return appendOnlyDumpManifestSchema.parse(JSON.parse(content.toString('utf8')))
  }

  const assertManifestFileNames = (manifest: AppendOnlyDumpManifest) => {
    const expectedArtifactFileName = `append-only-${manifest.month}.json.gz`
    const expectedSourceFileName = `append-only-${manifest.month}.sqlite`
    if (
      manifest.artifactFileName !== expectedArtifactFileName ||
      manifest.sourceFileName !== expectedSourceFileName
    ) {
      throw new Error('Refusing cleanup because the dump manifest contains unexpected file names')
    }
  }

  const initialManifest = await readVerifiedManifest()
  assertMonth(initialManifest.month)
  assertManifestFileNames(initialManifest)
  assertInactiveMonth(initialManifest.month, now, 'remove')
  const monthLock = acquireAppendOnlyMonthLock(appendOnlyDir, initialManifest.month)
  let publicationLock: ReturnType<typeof acquireDumpPublicationLock> | undefined
  try {
    publicationLock = acquireDumpPublicationLock(path.dirname(manifestPath), initialManifest.month)
    const manifest = await readVerifiedManifest()
    if (manifest.month !== initialManifest.month) {
      throw new Error('Refusing cleanup because the dump manifest changed during verification')
    }
    assertManifestFileNames(manifest)
    const artifactPath = path.join(path.dirname(manifestPath), manifest.artifactFileName)
    const dumpResult: AppendOnlyDumpResult = {
      filePath: artifactPath,
      fileSha256: manifest.fileSha256,
      manifestFileSha256: verifiedManifestSha256,
      manifestPath,
      month: manifest.month,
      sourceFileSha256: manifest.sourceFileSha256,
      tables: manifest.tables,
    }

    if ((await computeFileSha256(artifactPath)) !== manifest.fileSha256) {
      throw new Error(
        'Refusing cleanup because the published dump artifact checksum does not match',
      )
    }

    const sqlitePath = path.join(appendOnlyDir, manifest.sourceFileName)
    if (
      (await fileExists(sqlitePath)) &&
      (await computeFileSha256(sqlitePath)) !== manifest.sourceFileSha256
    ) {
      throw new Error('Refusing to remove an append-only SQLite file that changed after export')
    }
    const sqliteFiles = [sqlitePath, `${sqlitePath}-shm`, `${sqlitePath}-wal`]
    for (const file of sqliteFiles) {
      await fsPromises.rm(file, { force: true })
    }
    for (const file of sqliteFiles) {
      if (await fileExists(file)) {
        throw new Error(`Unable to remove append-only SQLite file: ${path.basename(file)}`)
      }
    }
    return dumpResult
  } finally {
    try {
      publicationLock?.release()
    } finally {
      monthLock.release()
    }
  }
}
