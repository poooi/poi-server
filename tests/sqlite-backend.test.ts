import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import Database from 'better-sqlite3'
import crypto from 'crypto'
import fs from 'fs/promises'
import mongoose from 'mongoose'
import { type AddressInfo } from 'net'
import os from 'os'
import path from 'path'
import zlib from 'zlib'

const sentryMocks = vi.hoisted(() => ({
  finish: vi.fn(),
  setContext: vi.fn(),
  setHttpStatus: vi.fn(),
  setName: vi.fn(),
  setTags: vi.fn(),
  setUser: vi.fn(),
  startInactiveSpan: vi.fn(),
  continueTrace: vi.fn((_headers, callback) => callback()),
  withActiveSpan: vi.fn((_span, callback) => callback()),
  withScope: vi.fn(),
}))

const dfMock = vi.hoisted(() => vi.fn(async () => [{ mountpoint: '/', size: 100 }]))

vi.mock('@sentry/node', () => ({
  startInactiveSpan: sentryMocks.startInactiveSpan,
  continueTrace: sentryMocks.continueTrace,
  setHttpStatus: sentryMocks.setHttpStatus,
  withActiveSpan: sentryMocks.withActiveSpan,
  withScope: sentryMocks.withScope,
  captureException: vi.fn(),
}))

vi.mock('@sindresorhus/df', () => ({
  default: dfMock,
}))

import { startServer } from '../src/server'
import {
  exportAppendOnlyMonth,
  removeManifestValidatedAppendOnlyMonth,
  type AppendOnlyDumpResult,
} from '../src/db/sqlite/dump'
import { runAppendOnlyDumpCli } from '../src/db/sqlite/dump-cli'
import { stripSqliteDatabaseUrl } from '../src/db/backend'

describe('SQLite backend selection', () => {
  let tempDir: string | undefined
  let originalAppendOnlyDir: string | undefined
  let originalQueueSize: string | undefined

  beforeEach(() => {
    sentryMocks.startInactiveSpan.mockReturnValue({
      end: sentryMocks.finish,
      updateName: sentryMocks.setName,
    })
    sentryMocks.withScope.mockImplementation((callback) =>
      callback({
        setContext: sentryMocks.setContext,
        setTags: sentryMocks.setTags,
        setUser: sentryMocks.setUser,
      }),
    )
  })

  afterEach(async () => {
    mongoose.set('bufferTimeoutMS', 10000)
    if (originalAppendOnlyDir == null) {
      delete process.env.POI_SERVER_SQLITE_APPEND_ONLY_DIR
    } else {
      process.env.POI_SERVER_SQLITE_APPEND_ONLY_DIR = originalAppendOnlyDir
    }
    if (tempDir != null) {
      await fs.rm(tempDir, { force: true, recursive: true })
      tempDir = undefined
    }
    if (originalQueueSize == null) {
      delete process.env.POI_SERVER_SQLITE_WRITE_QUEUE_SIZE
    } else {
      process.env.POI_SERVER_SQLITE_WRITE_QUEUE_SIZE = originalQueueSize
    }
    vi.restoreAllMocks()
  })

  const createTempSqliteEnvironment = async () => {
    originalAppendOnlyDir = process.env.POI_SERVER_SQLITE_APPEND_ONLY_DIR
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'poi-sqlite-'))
    const appendOnlyDir = path.join(tempDir, 'append-only')
    await fs.mkdir(appendOnlyDir)
    process.env.POI_SERVER_SQLITE_APPEND_ONLY_DIR = appendOnlyDir
    return {
      appendOnlyDir,
      operationalUrl: `sqlite://${path.join(tempDir, 'operational.sqlite')}`,
    }
  }

  const startSqliteServer = async (
    environment?: Awaited<ReturnType<typeof createTempSqliteEnvironment>>,
  ) => {
    const sqliteEnvironment = environment || (await createTempSqliteEnvironment())
    const started = await startServer({
      db: sqliteEnvironment.operationalUrl,
      disableLogger: true,
      host: '127.0.0.1',
      loadLatestCommit: false,
      port: 0,
    })
    const address = started.server.address() as AddressInfo
    return {
      ...sqliteEnvironment,
      baseUrl: `http://127.0.0.1:${address.port}`,
      close: started.close,
    }
  }

  const postReport = (
    baseUrl: string,
    path: string,
    data: unknown,
    reporter = 'Reporter/8.1.0 poi/10.3.99',
  ) =>
    fetch(`${baseUrl}${path}`, {
      body: JSON.stringify({ data }),
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-reporter': reporter,
      },
      method: 'POST',
    })

  const getAppendOnlyMonth = async (appendOnlyDir: string) => {
    const files = await fs.readdir(appendOnlyDir)
    const fileName = files.find((file) => /^append-only-\d{4}-\d{2}\.sqlite$/.test(file))
    if (fileName == null) {
      throw new Error('No append-only SQLite file was created')
    }
    return fileName.replace(/^append-only-/, '').replace(/\.sqlite$/, '')
  }

  const getDumpableTime = (month: string) => {
    const [year, monthNumber] = month.split('-').map(Number)
    return Date.UTC(year, monthNumber, 2)
  }

  const removeExportedMonth = (
    appendOnlyDir: string,
    dump: AppendOnlyDumpResult,
    now = Date.now(),
  ) =>
    removeManifestValidatedAppendOnlyMonth({
      appendOnlyDir,
      manifestPath: dump.manifestPath,
      now,
      verifiedManifestSha256: dump.manifestFileSha256,
    })

  test('starts with a sqlite database URL without connecting to MongoDB', async () => {
    const mongoConnect = vi.spyOn(mongoose, 'connect')
    const { close, baseUrl, operationalUrl } = await startSqliteServer()

    expect(operationalUrl).toContain('sqlite://')

    const response = await fetch(`${baseUrl}/api/service-status-badge`)

    await close()

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('service')
    expect(mongoConnect).not.toHaveBeenCalled()
  })

  test('starts with sqlite: URLs that do not use the sqlite:// form', async () => {
    const mongoConnect = vi.spyOn(mongoose, 'connect')
    const environment = await createTempSqliteEnvironment()
    const started = await startServer({
      db: `sqlite:${environment.operationalUrl.replace(/^sqlite:\/\//, '')}`,
      disableLogger: true,
      host: '127.0.0.1',
      loadLatestCommit: false,
      port: 0,
    })
    const address = started.server.address() as AddressInfo

    const response = await fetch(`http://127.0.0.1:${address.port}/api/service-status-badge`)

    await started.close()

    expect(response.status).toBe(200)
    expect(mongoConnect).not.toHaveBeenCalled()
  })

  test.runIf(process.platform === 'win32')(
    'normalizes standard SQLite file URLs with Windows drive letters',
    () => {
      expect(stripSqliteDatabaseUrl('sqlite:///C:/data/operational.sqlite')).toBe(
        'C:/data/operational.sqlite',
      )
    },
  )

  test('rejects a second in-process SQLite server without disturbing the first', async () => {
    const firstEnvironment = await createTempSqliteEnvironment()
    const firstServer = await startSqliteServer(firstEnvironment)
    const secondRoot = path.join(tempDir as string, 'second-server')
    const secondEnvironment = {
      appendOnlyDir: path.join(secondRoot, 'append-only'),
      operationalUrl: `sqlite://${path.join(secondRoot, 'operational.sqlite')}`,
    }
    await fs.mkdir(secondEnvironment.appendOnlyDir, { recursive: true })
    process.env.POI_SERVER_SQLITE_APPEND_ONLY_DIR = secondEnvironment.appendOnlyDir

    await expect(startSqliteServer(secondEnvironment)).rejects.toThrow(
      'A SQLite server is already running in this process',
    )
    const response = await postReport(firstServer.baseUrl, '/api/report/v2/create_item', {
      items: [10],
      successful: true,
    })
    await firstServer.close()

    expect(response.status).toBe(200)
    await expect(getAppendOnlyMonth(firstEnvironment.appendOnlyDir)).resolves.toMatch(
      /^\d{4}-\d{2}$/,
    )
    const secondServer = await startSqliteServer(secondEnvironment)
    await secondServer.close()
  })

  test('rejects sqlite database URLs without a path', async () => {
    await expect(
      startServer({
        db: 'sqlite:',
        disableLogger: true,
        host: '127.0.0.1',
        loadLatestCommit: false,
        port: 0,
      }),
    ).rejects.toThrow('SQLite database URL must include a path')
  })

  test('commits create item reports to the append-only monthly SQLite file', async () => {
    mongoose.set('bufferTimeoutMS', 100)
    const { appendOnlyDir, baseUrl, close } = await startSqliteServer()

    const response = await postReport(baseUrl, '/api/report/v2/create_item', {
      items: [10, 20, 30, 40],
      secretary: 100,
      itemId: 15,
      teitokuLv: 120,
      successful: true,
    })

    await close()

    const receiptMonth = await getAppendOnlyMonth(appendOnlyDir)
    const db = new Database(path.join(appendOnlyDir, `append-only-${receiptMonth}.sqlite`), {
      readonly: true,
    })
    const row = (() => {
      try {
        return db
          .prepare(
            'SELECT item_id, origin, successful, items_json FROM create_item_records ORDER BY id DESC LIMIT 1',
          )
          .get() as
          | {
              item_id: number
              items_json: string
              origin: string
              successful: number
            }
          | undefined
      } finally {
        db.close()
      }
    })()

    expect(response.status).toBe(200)
    expect(row).toEqual({
      item_id: 15,
      items_json: JSON.stringify([10, 20, 30, 40]),
      origin: 'Reporter/8.1.0 poi/10.3.99',
      successful: 1,
    })
  })

  test('returns retryable 503 when the SQLite write queue is full', async () => {
    originalQueueSize = process.env.POI_SERVER_SQLITE_WRITE_QUEUE_SIZE
    process.env.POI_SERVER_SQLITE_WRITE_QUEUE_SIZE = '0'
    const { baseUrl, close } = await startSqliteServer()

    const response = await postReport(baseUrl, '/api/report/v2/create_item', {
      items: [10, 20, 30, 40],
      secretary: 100,
      itemId: 15,
      teitokuLv: 120,
      successful: true,
    })

    await close()

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'SQLite write queue is full' })
  })

  test('commits create ship reports to the append-only monthly SQLite file', async () => {
    mongoose.set('bufferTimeoutMS', 100)
    const { appendOnlyDir, baseUrl, close } = await startSqliteServer()

    const response = await postReport(baseUrl, '/api/report/v2/create_ship', {
      items: [30, 30, 30, 30],
      kdockId: 1,
      secretary: 100,
      shipId: 101,
      highspeed: 0,
      teitokuLv: 120,
      largeFlag: false,
    })

    await close()

    const receiptMonth = await getAppendOnlyMonth(appendOnlyDir)
    const db = new Database(path.join(appendOnlyDir, `append-only-${receiptMonth}.sqlite`), {
      readonly: true,
    })
    const row = (() => {
      try {
        return db
          .prepare(
            'SELECT items_json, kdock_id, secretary, ship_id, highspeed, teitoku_lv, large_flag, origin FROM create_ship_records ORDER BY id DESC LIMIT 1',
          )
          .get() as
          | {
              highspeed: number
              items_json: string
              kdock_id: number
              large_flag: number
              origin: string
              secretary: number
              ship_id: number
              teitoku_lv: number
            }
          | undefined
      } finally {
        db.close()
      }
    })()

    expect(response.status).toBe(200)
    expect(row).toEqual({
      highspeed: 0,
      items_json: JSON.stringify([30, 30, 30, 30]),
      kdock_id: 1,
      large_flag: 0,
      origin: 'Reporter/8.1.0 poi/10.3.99',
      secretary: 100,
      ship_id: 101,
      teitoku_lv: 120,
    })
  })

  test('commits drop ship reports with current snapshot normalization', async () => {
    mongoose.set('bufferTimeoutMS', 100)
    const { appendOnlyDir, baseUrl, close } = await startSqliteServer()

    const earlyMapResponse = await postReport(baseUrl, '/api/report/v2/drop_ship', {
      shipId: 1,
      itemId: 0,
      mapId: 72,
      quest: 'A',
      cellId: 1,
      enemy: 'enemy',
      rank: 'S',
      isBoss: true,
      teitokuLv: 120,
      mapLv: 1,
      enemyShips1: [1],
      enemyShips2: [],
      enemyFormation: 1,
      baseExp: 100,
      teitokuId: 'admiral-1',
      shipCounts: [1],
      ownedShipSnapshot: { 1: [100] },
    })
    const lateMapResponse = await postReport(baseUrl, '/api/report/v2/drop_ship', {
      shipId: 2,
      itemId: 0,
      mapId: 73,
      quest: 'A',
      cellId: 2,
      enemy: 'enemy',
      rank: 'S',
      isBoss: true,
      teitokuLv: 120,
      mapLv: 1,
      enemyShips1: [1],
      enemyShips2: [],
      enemyFormation: 1,
      baseExp: 100,
      teitokuId: 'admiral-1',
      shipCounts: [1],
      ownedShipSnapshot: { 1: [100] },
    })

    await close()

    const receiptMonth = await getAppendOnlyMonth(appendOnlyDir)
    const db = new Database(path.join(appendOnlyDir, `append-only-${receiptMonth}.sqlite`), {
      readonly: true,
    })
    const rows = (() => {
      try {
        return db
          .prepare(
            'SELECT ship_id, map_id, cell_id, owned_ship_snapshot_json FROM drop_ship_records ORDER BY id',
          )
          .all() as Array<{
          cell_id: number
          map_id: number
          owned_ship_snapshot_json: string
          ship_id: number
        }>
      } finally {
        db.close()
      }
    })()

    expect(earlyMapResponse.status).toBe(200)
    expect(lateMapResponse.status).toBe(200)
    expect(rows).toEqual([
      {
        cell_id: 1,
        map_id: 72,
        owned_ship_snapshot_json: JSON.stringify({}),
        ship_id: 1,
      },
      {
        cell_id: 2,
        map_id: 73,
        owned_ship_snapshot_json: JSON.stringify({ 1: [100] }),
        ship_id: 2,
      },
    ])
  })

  test('commits night contact reports through the legacy night_contcat route', async () => {
    mongoose.set('bufferTimeoutMS', 100)
    const { appendOnlyDir, baseUrl, close } = await startSqliteServer()

    const response = await postReport(baseUrl, '/api/report/v2/night_contcat', {
      fleetType: 1,
      shipId: 100,
      shipLv: 90,
      itemId: 102,
      itemLv: 3,
      contact: true,
    })

    await close()

    const receiptMonth = await getAppendOnlyMonth(appendOnlyDir)
    const db = new Database(path.join(appendOnlyDir, `append-only-${receiptMonth}.sqlite`), {
      readonly: true,
    })
    const row = (() => {
      try {
        return db
          .prepare(
            'SELECT fleet_type, ship_id, ship_lv, item_id, item_lv, contact FROM night_contact_records ORDER BY id DESC LIMIT 1',
          )
          .get() as
          | {
              contact: number
              fleet_type: number
              item_id: number
              item_lv: number
              ship_id: number
              ship_lv: number
            }
          | undefined
      } finally {
        db.close()
      }
    })()

    expect(response.status).toBe(200)
    expect(row).toEqual({
      contact: 1,
      fleet_type: 1,
      item_id: 102,
      item_lv: 3,
      ship_id: 100,
      ship_lv: 90,
    })
  })

  test('commits only eligible AACI reports to the append-only monthly SQLite file', async () => {
    mongoose.set('bufferTimeoutMS', 100)
    const { appendOnlyDir, baseUrl, close } = await startSqliteServer()

    const eligibleResponse = await postReport(
      baseUrl,
      '/api/report/v2/aaci',
      {
        poiVersion: '7.9.2',
        available: [1],
        triggered: 1,
        items: [2],
        improvement: [0],
        rawLuck: 50,
        rawTaiku: 80,
        lv: 99,
        hpPercent: 100,
        pos: 1,
      },
      'Reporter 3.6.0',
    )
    const ineligibleResponse = await postReport(
      baseUrl,
      '/api/report/v2/aaci',
      {
        poiVersion: '7.9.1',
        available: [1],
        triggered: 1,
        items: [2],
        improvement: [0],
        rawLuck: 50,
        rawTaiku: 80,
        lv: 99,
        hpPercent: 100,
        pos: 1,
      },
      'Reporter 3.6.0',
    )

    await close()

    const receiptMonth = await getAppendOnlyMonth(appendOnlyDir)
    const db = new Database(path.join(appendOnlyDir, `append-only-${receiptMonth}.sqlite`), {
      readonly: true,
    })
    const rows = (() => {
      try {
        return db
          .prepare('SELECT poi_version, origin, available_json, triggered FROM aaci_records')
          .all() as Array<{
          available_json: string
          origin: string
          poi_version: string
          triggered: number
        }>
      } finally {
        db.close()
      }
    })()

    expect(eligibleResponse.status).toBe(200)
    expect(ineligibleResponse.status).toBe(200)
    expect(rows).toEqual([
      {
        available_json: JSON.stringify([1]),
        origin: 'Reporter 3.6.0',
        poi_version: '7.9.2',
        triggered: 1,
      },
    ])
  })

  test('exports a monthly append-only SQLite file with counts and checksum', async () => {
    const { appendOnlyDir, baseUrl, close } = await startSqliteServer()
    await postReport(baseUrl, '/api/report/v2/create_item', {
      items: [10, 20, 30, 40],
      secretary: 100,
      itemId: 15,
      teitokuLv: 120,
      successful: true,
    })
    await postReport(baseUrl, '/api/report/v2/create_ship', {
      items: [30, 30, 30, 30],
      kdockId: 1,
      secretary: 100,
      shipId: 101,
      highspeed: 0,
      teitokuLv: 120,
      largeFlag: false,
    })
    await postReport(baseUrl, '/api/report/v2/drop_ship', {
      shipId: 1,
      itemId: 0,
      mapId: 72,
      quest: 'A',
      cellId: 1,
      enemy: 'enemy',
      rank: 'S',
      isBoss: true,
      teitokuLv: 120,
      mapLv: 1,
      enemyShips1: [1],
      enemyShips2: [],
      enemyFormation: 1,
      baseExp: 100,
      teitokuId: 'admiral-1',
      shipCounts: [1],
      ownedShipSnapshot: { 1: [100] },
    })
    await postReport(baseUrl, '/api/report/v2/night_contcat', {
      fleetType: 1,
      shipId: 100,
      shipLv: 90,
      itemId: 102,
      itemLv: 3,
      contact: true,
    })
    await postReport(
      baseUrl,
      '/api/report/v2/aaci',
      {
        poiVersion: '7.9.2',
        available: [1],
        triggered: 1,
        items: [2],
        improvement: [0],
        rawLuck: 50,
        rawTaiku: 80,
        lv: 99,
        hpPercent: 100,
        pos: 1,
      },
      'Reporter 3.6.0',
    )
    await close()
    const outputDir = path.join(tempDir as string, 'dumps')
    await fs.mkdir(outputDir)
    const receiptMonth = await getAppendOnlyMonth(appendOnlyDir)
    vi.spyOn(Date, 'now').mockReturnValue(getDumpableTime(receiptMonth))

    const result = await exportAppendOnlyMonth({
      appendOnlyDir,
      month: receiptMonth,
      outputDir,
    })
    const gzipBuffer = await fs.readFile(result.filePath)
    const exported = JSON.parse(zlib.gunzipSync(gzipBuffer).toString('utf8')) as {
      aacirecords: Array<{ poiVersion: string }>
      createitemrecords: Array<{ itemId: number; origin: string }>
      createshiprecords: Array<{ shipId: number }>
      dropshiprecords: Array<{
        mapId: number
        ownedShipSnapshot: Record<string, unknown>
        shipCounts?: unknown
      }>
      nightcontactrecords: Array<{ contact: boolean }>
    }

    expect(result.month).toBe(receiptMonth)
    expect(result.tables.createitemrecords.count).toBe(1)
    expect(result.tables.createshiprecords.count).toBe(1)
    expect(result.tables.dropshiprecords.count).toBe(1)
    expect(result.tables.nightcontactrecords.count).toBe(1)
    expect(result.tables.aacirecords.count).toBe(1)
    expect(result.fileSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(exported.createitemrecords).toMatchObject([
      {
        _id: expect.stringMatching(/^[a-f0-9]{24}$/),
        itemId: 15,
        origin: 'Reporter/8.1.0 poi/10.3.99',
      },
    ])
    expect(exported.createshiprecords).toMatchObject([
      { _id: expect.stringMatching(/^[a-f0-9]{24}$/), shipId: 101 },
    ])
    expect(exported.dropshiprecords).toMatchObject([
      {
        _id: expect.stringMatching(/^[a-f0-9]{24}$/),
        mapId: 72,
        ownedShipSnapshot: {},
      },
    ])
    expect(exported.dropshiprecords[0]).not.toHaveProperty('shipCounts')
    expect(exported.nightcontactrecords).toMatchObject([
      { _id: expect.stringMatching(/^[a-f0-9]{24}$/), contact: true },
    ])
    expect(exported.aacirecords).toMatchObject([
      { _id: expect.stringMatching(/^[a-f0-9]{24}$/), poiVersion: '7.9.2' },
    ])
  })

  test('normalizes append-only reports before publishing their dump records', async () => {
    const { appendOnlyDir, baseUrl, close } = await startSqliteServer()
    await postReport(baseUrl, '/api/report/v2/create_item', {
      items: ['10'],
      secretary: '100',
      itemId: '15',
      teitokuLv: '120',
      successful: 'false',
    })
    await postReport(baseUrl, '/api/report/v2/create_ship', {
      items: ['10'],
      kdockId: '1',
      secretary: '100',
      shipId: '2',
      highspeed: '0',
      teitokuLv: '120',
      largeFlag: 'false',
    })
    await postReport(baseUrl, '/api/report/v2/drop_ship', {
      shipId: '2',
      itemId: '3',
      mapId: '73',
      quest: 'test',
      cellId: '1',
      enemy: 'enemy',
      rank: 'S',
      isBoss: 'false',
      teitokuLv: '120',
      mapLv: '1',
      enemyShips1: ['1'],
      enemyShips2: ['2'],
      enemyFormation: '1',
      baseExp: '100',
      teitokuId: '1',
      ownedShipSnapshot: {},
    })
    await postReport(baseUrl, '/api/report/v2/night_contcat', {
      fleetType: '1',
      shipId: '2',
      shipLv: '3',
      itemId: '4',
      itemLv: '5',
      contact: 'false',
    })
    await close()
    const outputDir = path.join(tempDir as string, 'normalized-dump')
    const receiptMonth = await getAppendOnlyMonth(appendOnlyDir)
    vi.spyOn(Date, 'now').mockReturnValue(getDumpableTime(receiptMonth))
    const dump = await exportAppendOnlyMonth({
      appendOnlyDir,
      month: receiptMonth,
      outputDir,
    })
    const exported = JSON.parse(
      zlib.gunzipSync(await fs.readFile(dump.filePath)).toString('utf8'),
    ) as Record<string, Array<Record<string, unknown>>>

    expect(exported.createitemrecords).toMatchObject([
      { itemId: 15, items: [10], successful: false },
    ])
    expect(exported.createshiprecords).toMatchObject([{ items: [10], largeFlag: false, shipId: 2 }])
    expect(exported.dropshiprecords).toMatchObject([
      { enemyShips1: [1], enemyShips2: [2], isBoss: false, mapId: 73 },
    ])
    expect(exported.nightcontactrecords).toMatchObject([{ contact: false, itemId: 4, shipId: 2 }])
  })

  test('rejects append-only reports with Mongoose cast errors', async () => {
    const { baseUrl, close } = await startSqliteServer()
    const response = await postReport(baseUrl, '/api/report/v2/create_item', {
      items: ['invalid'],
      successful: 'not-a-boolean',
    })
    const statusResponse = await fetch(`${baseUrl}/api/status`)
    await close()

    expect(response.status).toBe(500)
    expect(await statusResponse.json()).toMatchObject({
      sqlite: {
        CreateItemRecord: 0,
      },
    })
  })

  test('refuses to export the active append-only month', async () => {
    const { appendOnlyDir, baseUrl, close } = await startSqliteServer()
    await postReport(baseUrl, '/api/report/v2/create_item', {
      items: [10, 20, 30, 40],
      secretary: 100,
      itemId: 15,
      teitokuLv: 120,
      successful: true,
    })
    await close()
    const outputDir = path.join(tempDir as string, 'dumps')
    const receiptMonth = await getAppendOnlyMonth(appendOnlyDir)

    await expect(
      exportAppendOnlyMonth({
        appendOnlyDir,
        month: receiptMonth,
        outputDir,
      }),
    ).rejects.toThrow('Refusing to export an active append-only SQLite month')
  })

  test('refuses dump maintenance while the API server owns the monthly database', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 5, 15))
    const { appendOnlyDir, baseUrl, close } = await startSqliteServer()
    await postReport(baseUrl, '/api/report/v2/create_item', {
      items: [10, 20, 30, 40],
      secretary: 100,
      itemId: 15,
      teitokuLv: 120,
      successful: true,
    })
    now.mockReturnValue(Date.UTC(2026, 6, 2))
    const outputDir = path.join(tempDir as string, 'dumps')

    await expect(
      exportAppendOnlyMonth({
        appendOnlyDir,
        month: '2026-06',
        outputDir,
      }),
    ).rejects.toThrow('Append-only SQLite month 2026-06 is currently in use')

    await close()
    await expect(
      exportAppendOnlyMonth({
        appendOnlyDir,
        month: '2026-06',
        outputDir,
      }),
    ).resolves.toMatchObject({ month: '2026-06' })
  })

  test('rejects invalid dump month paths before opening or deleting files', async () => {
    const { appendOnlyDir, baseUrl, close } = await startSqliteServer()
    await postReport(baseUrl, '/api/report/v2/create_item', {
      items: [10, 20, 30, 40],
      secretary: 100,
      itemId: 15,
      teitokuLv: 120,
      successful: true,
    })
    await close()
    const outputDir = path.join(tempDir as string, 'dumps')

    await expect(
      exportAppendOnlyMonth({
        appendOnlyDir,
        month: '..\\evil',
        outputDir,
      }),
    ).rejects.toThrow('Month must use YYYY-MM format')
    await expect(
      (async () => {
        await fs.mkdir(outputDir, { recursive: true })
        const manifestPath = path.join(outputDir, 'invalid-month.manifest.json')
        const manifest = `${JSON.stringify({
          artifactFileName: 'append-only-..\\evil.json.gz',
          fileSha256: 'a'.repeat(64),
          month: '..\\evil',
          sourceFileName: 'append-only-..\\evil.sqlite',
          sourceFileSha256: 'a'.repeat(64),
          tables: {},
          version: 1,
        })}\n`
        await fs.writeFile(manifestPath, manifest)
        return removeManifestValidatedAppendOnlyMonth({
          appendOnlyDir,
          manifestPath,
          verifiedManifestSha256: crypto.createHash('sha256').update(manifest).digest('hex'),
        })
      })(),
    ).rejects.toThrow('Month must use YYYY-MM format')
    await expect(
      exportAppendOnlyMonth({
        appendOnlyDir,
        month: '2026-99',
        outputDir,
      }),
    ).rejects.toThrow('Month must use YYYY-MM format')
  })

  test('removes the monthly SQLite file only after a validated dump result', async () => {
    const { appendOnlyDir, baseUrl, close } = await startSqliteServer()
    await postReport(baseUrl, '/api/report/v2/create_item', {
      items: [10, 20, 30, 40],
      secretary: 100,
      itemId: 15,
      teitokuLv: 120,
      successful: true,
    })
    await close()
    const outputDir = path.join(tempDir as string, 'dumps')
    const receiptMonth = await getAppendOnlyMonth(appendOnlyDir)
    const sqliteFile = path.join(appendOnlyDir, `append-only-${receiptMonth}.sqlite`)
    const cleanupNow = getDumpableTime(receiptMonth)
    vi.spyOn(Date, 'now').mockReturnValue(cleanupNow)
    const dump = await exportAppendOnlyMonth({
      appendOnlyDir,
      month: receiptMonth,
      outputDir,
    })

    await removeExportedMonth(appendOnlyDir, dump, cleanupNow)
    await fs.writeFile(`${sqliteFile}-wal`, 'orphaned wal')
    await fs.writeFile(`${sqliteFile}-shm`, 'orphaned shm')
    await removeExportedMonth(appendOnlyDir, dump, cleanupNow)

    await expect(fs.stat(sqliteFile)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.stat(`${sqliteFile}-wal`)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.stat(`${sqliteFile}-shm`)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.stat(dump.filePath)).resolves.toMatchObject({ size: expect.any(Number) })
  })

  test('preserves a completed dump when a retry cannot reopen the source month', async () => {
    const { appendOnlyDir, baseUrl, close } = await startSqliteServer()
    await postReport(baseUrl, '/api/report/v2/create_item', {
      items: [10, 20, 30, 40],
      secretary: 100,
      itemId: 15,
      teitokuLv: 120,
      successful: true,
    })
    await close()
    const outputDir = path.join(tempDir as string, 'dumps')
    const receiptMonth = await getAppendOnlyMonth(appendOnlyDir)
    const cleanupNow = getDumpableTime(receiptMonth)
    vi.spyOn(Date, 'now').mockReturnValue(cleanupNow)
    const dump = await exportAppendOnlyMonth({
      appendOnlyDir,
      month: receiptMonth,
      outputDir,
    })
    const artifactBefore = await fs.readFile(dump.filePath)
    const manifestBefore = await fs.readFile(dump.manifestPath)
    await removeExportedMonth(appendOnlyDir, dump, cleanupNow)

    await expect(
      exportAppendOnlyMonth({
        appendOnlyDir,
        month: receiptMonth,
        outputDir,
      }),
    ).rejects.toThrow(`Append-only SQLite month ${receiptMonth} does not exist`)
    await expect(fs.readFile(dump.filePath)).resolves.toEqual(artifactBefore)
    await expect(fs.readFile(dump.manifestPath)).resolves.toEqual(manifestBefore)
  })

  test('reclaims stale temporary dump outputs before retrying export', async () => {
    const { appendOnlyDir, baseUrl, close } = await startSqliteServer()
    await postReport(baseUrl, '/api/report/v2/create_item', {
      items: [10, 20, 30, 40],
      successful: true,
    })
    await close()
    const receiptMonth = await getAppendOnlyMonth(appendOnlyDir)
    vi.spyOn(Date, 'now').mockReturnValue(getDumpableTime(receiptMonth))
    const outputDir = path.join(tempDir as string, 'dumps')
    await fs.mkdir(outputDir)
    const staleArtifact = path.join(outputDir, `append-only-${receiptMonth}.json.gz.tmp-123-stale`)
    const staleManifest = path.join(
      outputDir,
      `append-only-${receiptMonth}.manifest.json.tmp-123-stale`,
    )
    await fs.writeFile(staleArtifact, 'partial artifact')
    await fs.writeFile(staleManifest, 'partial manifest')

    await exportAppendOnlyMonth({
      appendOnlyDir,
      month: receiptMonth,
      outputDir,
    })

    await expect(fs.stat(staleArtifact)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.stat(staleManifest)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('does not overwrite dump outputs published concurrently for the same month', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 5, 15))
    const firstEnvironment = await createTempSqliteEnvironment()
    const firstServer = await startSqliteServer(firstEnvironment)
    await postReport(firstServer.baseUrl, '/api/report/v2/create_item', {
      items: [1],
      successful: true,
    })
    await firstServer.close()

    const secondRoot = path.join(tempDir as string, 'second')
    const secondEnvironment = {
      appendOnlyDir: path.join(secondRoot, 'append-only'),
      operationalUrl: `sqlite://${path.join(secondRoot, 'operational.sqlite')}`,
    }
    await fs.mkdir(secondEnvironment.appendOnlyDir, { recursive: true })
    process.env.POI_SERVER_SQLITE_APPEND_ONLY_DIR = secondEnvironment.appendOnlyDir
    const secondServer = await startSqliteServer(secondEnvironment)
    await postReport(secondServer.baseUrl, '/api/report/v2/create_item', {
      items: [2],
      successful: true,
    })
    await secondServer.close()

    now.mockReturnValue(Date.UTC(2026, 6, 2))
    const outputDir = path.join(tempDir as string, 'shared-dumps')
    const results = await Promise.allSettled([
      exportAppendOnlyMonth({
        appendOnlyDir: firstEnvironment.appendOnlyDir,
        month: '2026-06',
        outputDir,
      }),
      exportAppendOnlyMonth({
        appendOnlyDir: secondEnvironment.appendOnlyDir,
        month: '2026-06',
        outputDir,
      }),
    ])
    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<AppendOnlyDumpResult> =>
        result.status === 'fulfilled',
    )
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    )

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0].reason).toMatchObject({
      message: expect.stringMatching(
        /Append-only dump outputs .* currently in use|Refusing to replace an existing dump output/,
      ),
    })
    const manifest = JSON.parse(await fs.readFile(fulfilled[0].value.manifestPath, 'utf8')) as {
      fileSha256: string
    }
    expect(
      crypto
        .createHash('sha256')
        .update(await fs.readFile(fulfilled[0].value.filePath))
        .digest('hex'),
    ).toBe(manifest.fileSha256)
  })

  test('refuses export when the inactive month cannot be fully checkpointed', async () => {
    const { appendOnlyDir, baseUrl, close } = await startSqliteServer()
    await postReport(baseUrl, '/api/report/v2/create_item', {
      items: [10, 20, 30, 40],
      secretary: 100,
      itemId: 15,
      teitokuLv: 120,
      successful: true,
    })
    await close()
    const receiptMonth = await getAppendOnlyMonth(appendOnlyDir)
    vi.spyOn(Date, 'now').mockReturnValue(getDumpableTime(receiptMonth))
    const sqlitePath = path.join(appendOnlyDir, `append-only-${receiptMonth}.sqlite`)
    const reader = new Database(sqlitePath, { readonly: true })
    const writer = new Database(sqlitePath)
    try {
      writer.pragma('journal_mode = WAL')
      reader.exec('BEGIN')
      reader.prepare('SELECT COUNT(*) FROM create_item_records').get()
      writer
        .prepare(
          `
            INSERT INTO create_item_records (
              public_id,
              received_at_ms,
              items_json,
              successful
            )
            VALUES (?, ?, ?, ?)
          `,
        )
        .run('f'.repeat(24), Date.now(), '[]', 1)
      writer.close()

      await expect(
        exportAppendOnlyMonth({
          appendOnlyDir,
          month: receiptMonth,
          outputDir: path.join(tempDir as string, 'dumps'),
        }),
      ).rejects.toThrow(`Unable to checkpoint append-only SQLite month ${receiptMonth}`)
    } finally {
      if (reader.inTransaction) {
        reader.exec('ROLLBACK')
      }
      reader.close()
      if (writer.open) {
        writer.close()
      }
    }
  })

  test('refuses cleanup when the dump artifact checksum does not match', async () => {
    const { appendOnlyDir, baseUrl, close } = await startSqliteServer()
    await postReport(baseUrl, '/api/report/v2/create_item', {
      items: [10, 20, 30, 40],
      secretary: 100,
      itemId: 15,
      teitokuLv: 120,
      successful: true,
    })
    await close()
    const outputDir = path.join(tempDir as string, 'dumps')
    const receiptMonth = await getAppendOnlyMonth(appendOnlyDir)
    const cleanupNow = getDumpableTime(receiptMonth)
    vi.spyOn(Date, 'now').mockReturnValue(cleanupNow)
    const dump = await exportAppendOnlyMonth({
      appendOnlyDir,
      month: receiptMonth,
      outputDir,
    })
    await fs.writeFile(dump.filePath, 'tampered')

    await expect(removeExportedMonth(appendOnlyDir, dump, cleanupNow)).rejects.toThrow(
      'Refusing cleanup because the published dump artifact checksum does not match',
    )
  })

  test('refuses cleanup when the exported SQLite snapshot has changed', async () => {
    const { appendOnlyDir, baseUrl, close } = await startSqliteServer()
    await postReport(baseUrl, '/api/report/v2/create_item', {
      items: [10, 20, 30, 40],
      secretary: 100,
      itemId: 15,
      teitokuLv: 120,
      successful: true,
    })
    await close()
    const outputDir = path.join(tempDir as string, 'dumps')
    const receiptMonth = await getAppendOnlyMonth(appendOnlyDir)
    const [year, month] = receiptMonth.split('-').map(Number)
    const cleanupNow = Date.UTC(year, month, 2)
    vi.spyOn(Date, 'now').mockReturnValue(cleanupNow)
    const dump = await exportAppendOnlyMonth({
      appendOnlyDir,
      month: receiptMonth,
      outputDir,
    })
    const sqlitePath = path.join(appendOnlyDir, `append-only-${receiptMonth}.sqlite`)
    const db = new Database(sqlitePath)
    try {
      db.prepare(
        `
          INSERT INTO create_item_records (
            public_id,
            received_at_ms,
            items_json,
            successful
          )
          VALUES (?, ?, ?, ?)
        `,
      ).run('0'.repeat(24), cleanupNow, '[]', 1)
    } finally {
      db.close()
    }

    await expect(removeExportedMonth(appendOnlyDir, dump, cleanupNow)).rejects.toThrow(
      'Refusing to remove an append-only SQLite file that changed after export',
    )
  })

  test('refuses to remove the previous month during the rollover grace day', async () => {
    const { appendOnlyDir, baseUrl, close } = await startSqliteServer()
    await postReport(baseUrl, '/api/report/v2/create_item', {
      items: [10, 20, 30, 40],
      secretary: 100,
      itemId: 15,
      teitokuLv: 120,
      successful: true,
    })
    await close()
    const outputDir = path.join(tempDir as string, 'dumps')
    const receiptMonth = await getAppendOnlyMonth(appendOnlyDir)
    vi.spyOn(Date, 'now').mockReturnValue(getDumpableTime(receiptMonth))
    const dump = await exportAppendOnlyMonth({
      appendOnlyDir,
      month: receiptMonth,
      outputDir,
    })

    await expect(
      removeExportedMonth(
        appendOnlyDir,
        dump,
        (() => {
          const [year, monthNumber] = receiptMonth.split('-').map(Number)
          return Date.UTC(year, monthNumber, 1)
        })(),
      ),
    ).rejects.toThrow('Refusing to remove the active append-only SQLite month')
  })

  test('runs append-only dump and cleanup through the external CLI seam', async () => {
    const { appendOnlyDir, baseUrl, close } = await startSqliteServer()
    await postReport(baseUrl, '/api/report/v2/create_item', {
      items: [10, 20, 30, 40],
      secretary: 100,
      itemId: 15,
      teitokuLv: 120,
      successful: true,
    })
    await close()
    const outputDir = path.join(tempDir as string, 'cli-dumps')
    const receiptMonth = await getAppendOnlyMonth(appendOnlyDir)
    const sqliteFile = path.join(appendOnlyDir, `append-only-${receiptMonth}.sqlite`)
    const [year, month] = receiptMonth.split('-').map(Number)
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(year, month, 2))

    const dump = await runAppendOnlyDumpCli([
      '--append-only-dir',
      appendOnlyDir,
      '--month',
      receiptMonth,
      '--output-dir',
      outputDir,
    ])
    await runAppendOnlyDumpCli([
      '--append-only-dir',
      appendOnlyDir,
      '--cleanup',
      '--manifest',
      dump.manifestPath,
      '--verified-manifest-sha256',
      dump.manifestFileSha256,
      '--confirm-local-delete',
    ])

    expect(dump.tables.createitemrecords.count).toBe(1)
    await expect(fs.stat(dump.manifestPath)).resolves.toMatchObject({ size: expect.any(Number) })
    await expect(fs.stat(dump.filePath)).resolves.toMatchObject({ size: expect.any(Number) })
    await expect(fs.stat(sqliteFile)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('requires explicit CLI confirmation before cleanup', async () => {
    const { appendOnlyDir, baseUrl, close } = await startSqliteServer()
    await postReport(baseUrl, '/api/report/v2/create_item', {
      items: [10, 20, 30, 40],
      secretary: 100,
      itemId: 15,
      teitokuLv: 120,
      successful: true,
    })
    await close()
    const outputDir = path.join(tempDir as string, 'cli-dumps')
    const receiptMonth = await getAppendOnlyMonth(appendOnlyDir)

    await expect(
      runAppendOnlyDumpCli([
        '--append-only-dir',
        appendOnlyDir,
        '--month',
        receiptMonth,
        '--output-dir',
        outputDir,
        '--cleanup',
      ]),
    ).rejects.toThrow('--cleanup requires --confirm-local-delete')
  })

  test('does not allow the cleanup clock to be overridden from the CLI', async () => {
    await expect(
      runAppendOnlyDumpCli([
        '--append-only-dir',
        'append-only',
        '--month',
        '2026-06',
        '--output-dir',
        'dumps',
        '--cleanup',
        '--confirm-local-delete',
        '--now',
        '2099-01-02T00:00:00.000Z',
      ]),
    ).rejects.toThrow('Unknown argument: --now')
  })

  test('stores v3 quests in the operational SQLite database and exposes known quest prefixes', async () => {
    mongoose.set('bufferTimeoutMS', 100)
    const { baseUrl, close } = await startSqliteServer()

    const questResponse = await postReport(
      baseUrl,
      '/api/report/v3/quest',
      JSON.stringify({
        quests: [
          {
            questId: 801,
            category: 2,
            type: 1,
            title: 'Test quest',
            detail: 'Test details',
          },
        ],
      }),
    )
    const knownQuestsResponse = await fetch(`${baseUrl}/api/report/v3/known_quests`)

    await close()

    expect(questResponse.status).toBe(200)
    expect(knownQuestsResponse.status).toBe(200)
    expect(await knownQuestsResponse.json()).toEqual({ quests: ['8b6799d1'] })
  })

  test('stores v3 quest rewards in the operational SQLite database with legacy bounsCount', async () => {
    mongoose.set('bufferTimeoutMS', 100)
    const { operationalUrl, baseUrl, close } = await startSqliteServer()

    const response = await postReport(baseUrl, '/api/report/v3/quest_reward', {
      questId: 901,
      title: 'Reward quest',
      detail: 'Reward details',
      category: 2,
      type: 1,
      selections: [1],
      material: [0, 0, 0, 0],
      bonus: [{ type: 'item', id: 1 }],
      bounsCount: 1,
    })

    await close()

    const db = new Database(operationalUrl.replace(/^sqlite:\/\//, ''), { readonly: true })
    const row = (() => {
      try {
        return db
          .prepare(
            'SELECT key, quest_id, selections_json, bouns_count, origin FROM quest_rewards LIMIT 1',
          )
          .get() as
          | {
              bouns_count: number
              key: string
              origin: string
              quest_id: number
              selections_json: string
            }
          | undefined
      } finally {
        db.close()
      }
    })()

    expect(response.status).toBe(200)
    expect(row).toEqual({
      bouns_count: 1,
      key: '12bd88872bd8320b5900b36276e8050e',
      origin: 'Reporter/8.1.0 poi/10.3.99',
      quest_id: 901,
      selections_json: JSON.stringify([1]),
    })
  })

  test('normalizes v3 quests and quest rewards before SQLite deduplication', async () => {
    const { baseUrl, close } = await startSqliteServer()
    const rewardPayload = {
      questId: '1',
      title: 'Reward',
      detail: 'Reward details',
      category: true,
      type: '1',
      selections: ['4'],
      material: ['0'],
      bonus: [],
      bounsCount: '1',
    }
    const firstQuest = await postReport(
      baseUrl,
      '/api/report/v3/quest',
      JSON.stringify({
        quests: [{ questId: '1', category: true, title: 'Quest', detail: 'Details' }],
      }),
    )
    const secondQuest = await postReport(
      baseUrl,
      '/api/report/v3/quest',
      JSON.stringify({
        quests: [{ questId: 1, category: 1, title: 'Quest', detail: 'Details' }],
      }),
    )
    const firstReward = await postReport(baseUrl, '/api/report/v3/quest_reward', rewardPayload)
    const secondReward = await postReport(baseUrl, '/api/report/v3/quest_reward', {
      ...rewardPayload,
      questId: 1,
      category: 1,
      type: 1,
      selections: [4],
      material: [0],
      bounsCount: 1,
    })
    const statusResponse = await fetch(`${baseUrl}/api/status`)
    await close()

    expect([
      firstQuest.status,
      secondQuest.status,
      firstReward.status,
      secondReward.status,
    ]).toEqual([200, 200, 200, 200])
    expect(await statusResponse.json()).toMatchObject({
      sqlite: {
        Quest: 1,
        QuestReward: 1,
      },
    })
  })

  test('deduplicates v3 quests and rewards with missing optional identity fields', async () => {
    const { baseUrl, close } = await startSqliteServer()
    const quest = JSON.stringify({
      quests: [{ title: 'Quest without IDs', detail: 'Details' }],
    })
    const reward = {
      title: 'Reward without IDs',
      detail: 'Reward details',
      selections: [],
      material: [],
      bonus: [],
    }
    const responses = [
      await postReport(baseUrl, '/api/report/v3/quest', quest),
      await postReport(baseUrl, '/api/report/v3/quest', quest),
      await postReport(baseUrl, '/api/report/v3/quest_reward', reward),
      await postReport(baseUrl, '/api/report/v3/quest_reward', reward),
    ]
    const statusResponse = await fetch(`${baseUrl}/api/status`)
    await close()

    expect(responses.map(({ status }) => status)).toEqual([200, 200, 200, 200])
    expect(await statusResponse.json()).toMatchObject({
      sqlite: {
        Quest: 1,
        QuestReward: 1,
      },
    })
  })

  test('handles representative v2 operational endpoints in SQLite mode', async () => {
    mongoose.set('bufferTimeoutMS', 100)
    const { operationalUrl, baseUrl, close } = await startSqliteServer()

    const firstRank = await postReport(baseUrl, '/api/report/v2/select_rank', {
      teitokuId: 'admiral-1',
      teitokuLv: 100,
      mapareaId: 5,
      rank: 1,
    })
    const secondRank = await postReport(baseUrl, '/api/report/v2/select_rank', {
      teitokuId: 'admiral-1',
      teitokuLv: 120,
      mapareaId: 5,
      rank: 3,
    })
    const recipe = await postReport(baseUrl, '/api/report/v2/remodel_recipe', {
      recipeId: 1,
      itemId: 2,
      stage: 3,
      day: 4,
      secretary: 5,
    })
    const shipStat = await postReport(baseUrl, '/api/report/v2/ship_stat', {
      id: 100,
      lv: 99,
      los: 80,
      los_max: 90,
      asw: 70,
      asw_max: 80,
      evasion: 60,
      evasion_max: 70,
    })
    const enemyInfo = await postReport(baseUrl, '/api/report/v2/enemy_info', {
      ships1: [1],
      levels1: [1],
      hp1: [10],
      stats1: [[1]],
      equips1: [[2]],
      ships2: [],
      levels2: [],
      hp2: [],
      stats2: [],
      equips2: [],
      planes: 3,
      bombersMin: 1,
      bombersMax: 5,
    })
    const secondEnemyInfo = await postReport(baseUrl, '/api/report/v2/enemy_info', {
      ships1: [1],
      levels1: [1],
      hp1: [10],
      stats1: [[1]],
      equips1: [[2]],
      ships2: [],
      levels2: [],
      hp2: [],
      stats2: [],
      equips2: [],
      planes: 3,
      bombersMin: 3,
      bombersMax: 4,
    })

    await close()
    const db = new Database(operationalUrl.replace(/^sqlite:\/\//, ''), { readonly: true })
    const enemyRow = (() => {
      try {
        return db.prepare('SELECT bombers_min, bombers_max, count FROM enemy_infos').get() as {
          bombers_max: number
          bombers_min: number
          count: number
        }
      } finally {
        db.close()
      }
    })()

    expect(firstRank.status).toBe(200)
    expect(secondRank.status).toBe(200)
    expect(recipe.status).toBe(200)
    expect(shipStat.status).toBe(200)
    expect(enemyInfo.status).toBe(200)
    expect(secondEnemyInfo.status).toBe(200)
    expect(enemyRow).toEqual({
      bombers_max: 4,
      bombers_min: 3,
      count: 2,
    })
  })

  test('normalizes operational reports before SQLite deduplication', async () => {
    const { baseUrl, close } = await startSqliteServer()
    const shipStat = {
      id: 100,
      lv: 50,
      los: 30,
      los_max: 40,
      asw: 70,
      asw_max: 80,
      evasion: 60,
      evasion_max: 70,
    }
    const enemyInfo = {
      ships1: [1],
      levels1: [1],
      hp1: [10],
      stats1: [[1]],
      equips1: [[2]],
      ships2: [],
      levels2: [],
      hp2: [],
      stats2: [],
      equips2: [],
      planes: 3,
      bombersMin: 1,
      bombersMax: 5,
    }
    await postReport(
      baseUrl,
      '/api/report/v2/ship_stat',
      Object.fromEntries(Object.entries(shipStat).map(([key, value]) => [key, String(value)])),
    )
    await postReport(baseUrl, '/api/report/v2/ship_stat', shipStat)
    await postReport(baseUrl, '/api/report/v2/enemy_info', {
      ...enemyInfo,
      ships1: ['1'],
      levels1: ['1'],
      hp1: ['10'],
      stats1: [['1']],
      equips1: [['2']],
      planes: '3',
      bombersMin: '1',
      bombersMax: '5',
    })
    await postReport(baseUrl, '/api/report/v2/enemy_info', enemyInfo)
    const selectRankResponse = await postReport(baseUrl, '/api/report/v2/select_rank', {
      teitokuId: 123,
      teitokuLv: '120',
      mapareaId: true,
      rank: '1',
    })
    const statusResponse = await fetch(`${baseUrl}/api/status`)
    await close()

    expect(selectRankResponse.status).toBe(200)
    expect(await statusResponse.json()).toMatchObject({
      sqlite: {
        EnemyInfo: 1,
        SelectRankRecord: 1,
        ShipStat: 1,
      },
    })
  })

  test('handles remaining v2 record endpoints in SQLite mode without Mongo fallback', async () => {
    mongoose.set('bufferTimeoutMS', 100)
    const { baseUrl, close } = await startSqliteServer()

    const responses = await Promise.all([
      postReport(baseUrl, '/api/report/v2/remodel_item', {
        successful: true,
        itemId: 200,
        itemLevel: 6,
        flagshipId: 100,
        flagshipLevel: 90,
        flagshipCond: 49,
        consortId: 101,
        consortLevel: 80,
        consortCond: 50,
        teitokuLv: 120,
        certain: false,
      }),
      postReport(baseUrl, '/api/report/v2/pass_event', {
        eventId: 1,
        mapId: 2,
      }),
      postReport(baseUrl, '/api/report/v2/battle_api', {
        path: '/kcsapi/api_req_sortie/battle',
        data: { api_result: 1 },
      }),
      postReport(baseUrl, '/api/report/v2/night_battle_ci', {
        shipId: 100,
        CI: 'cutin',
        type: 'torpedo',
        lv: 99,
        rawLuck: 50,
        pos: 1,
        status: 'normal',
        items: [1, 2],
        improvement: [0, 0],
        searchLight: false,
        flare: 0,
        defenseId: 0,
        defenseTypeId: 0,
        ciType: 1,
        display: [1],
        hitType: [1],
        damage: [100],
        damageTotal: 100,
        time: Date.now(),
      }),
    ])
    const nightBattleSsCiResponse = await postReport(baseUrl, '/api/report/v2/night_battle_ss_ci', {
      ignored: true,
    })
    const knownRecipesResponse = await fetch(`${baseUrl}/api/report/v2/known_recipes`)

    await close()

    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200])
    expect(nightBattleSsCiResponse.status).toBe(200)
    expect(knownRecipesResponse.status).toBe(200)
    expect(await knownRecipesResponse.json()).toEqual({ recipes: [] })
  })

  test('serves v2 known quests from operational SQLite quest data', async () => {
    mongoose.set('bufferTimeoutMS', 100)
    const { baseUrl, close } = await startSqliteServer()
    await postReport(
      baseUrl,
      '/api/report/v3/quest',
      JSON.stringify({
        quests: [
          { questId: 2, category: 1, title: 'B', detail: 'B details' },
          { questId: 10, category: 1, title: 'C', detail: 'C details' },
          { questId: 1, category: 1, title: 'A', detail: 'A details' },
        ],
      }),
    )

    const response = await fetch(`${baseUrl}/api/report/v2/known_quests`)

    await close()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('public, max-age=60')
    expect(response.headers.get('cdn-cache-control')).toBe(
      'public, max-age=600, stale-while-revalidate=60, stale-if-error=300',
    )
    expect(await response.json()).toEqual({ quests: [1, 10, 2] })
  })

  test('reports SQLite status counts without querying Mongo models', async () => {
    mongoose.set('bufferTimeoutMS', 100)
    const { baseUrl, close } = await startSqliteServer()
    await postReport(baseUrl, '/api/report/v2/create_item', {
      items: [10, 20, 30, 40],
      secretary: 100,
      itemId: 15,
      teitokuLv: 120,
      successful: true,
    })
    await postReport(
      baseUrl,
      '/api/report/v3/quest',
      JSON.stringify({
        quests: [{ questId: 1, category: 1, title: 'A', detail: 'A details' }],
      }),
    )
    await postReport(
      baseUrl,
      '/api/report/v3/quest',
      JSON.stringify({
        quests: [{ questId: 1, category: 1, title: 'A', detail: 'A details' }],
      }),
    )
    await postReport(baseUrl, '/api/report/v2/remodel_item', {
      successful: true,
      itemId: 200,
      itemLevel: 6,
    })
    const recipe = {
      recipeId: 1,
      itemId: 200,
      stage: 1,
      day: 5,
      secretary: 100,
    }
    await postReport(baseUrl, '/api/report/v2/remodel_recipe', recipe)
    await postReport(baseUrl, '/api/report/v2/remodel_recipe', recipe)
    await postReport(baseUrl, '/api/report/v2/remodel_recipe', { ...recipe, recipeId: 2 })
    await postReport(baseUrl, '/api/report/v2/pass_event', { eventId: 1 })
    await postReport(baseUrl, '/api/report/v2/battle_api', {
      path: '/kcsapi/api_req_sortie/battle',
    })

    const response = await fetch(`${baseUrl}/api/status`)

    await close()

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      backend: 'sqlite',
      mongo: {
        CreateItemRecord: 1,
        Quest: 1,
      },
      sqlite: {
        BattleAPI: 1,
        CreateItemRecord: 1,
        PassEventRecord: 1,
        Quest: 1,
        RecipeRecord: 2,
        RemodelItemRecord: 1,
      },
    })
  })

  test('SQLite status counts unopened append-only monthly files on disk', async () => {
    const sqliteEnvironment = await createTempSqliteEnvironment()
    const firstStart = await startSqliteServer(sqliteEnvironment)
    await postReport(firstStart.baseUrl, '/api/report/v2/create_item', {
      items: [10, 20, 30, 40],
      secretary: 100,
      itemId: 15,
      teitokuLv: 120,
      successful: true,
    })
    await firstStart.close()
    const restarted = await startSqliteServer(sqliteEnvironment)

    const response = await fetch(`${restarted.baseUrl}/api/status`)

    await restarted.close()

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      sqlite: {
        CreateItemRecord: 1,
      },
    })
  })

  test('ingests and exports item improvement availability facts in SQLite mode', async () => {
    mongoose.set('bufferTimeoutMS', 100)
    const { baseUrl, close } = await startSqliteServer()
    const observedAt = Date.UTC(2026, 6, 3, 15)

    const ingestResponse = await postReport(baseUrl, '/api/report/v3/item_improvement_recipe', {
      schemaVersion: 1,
      source: 'list',
      clientObservedAt: observedAt,
      recipeId: 33,
      itemId: 700,
      day: 6,
      observedSecondShipId: 0,
      observedFlagshipIds: [100],
    })
    const secondIngestResponse = await postReport(
      baseUrl,
      '/api/report/v3/item_improvement_recipe',
      {
        schemaVersion: 1,
        source: 'list',
        clientObservedAt: observedAt,
        recipeId: 33,
        itemId: 700,
        day: 6,
        observedSecondShipId: 0,
        observedFlagshipIds: [101],
      },
    )
    const exportResponse = await fetch(
      `${baseUrl}/api/report/v3/item_improvement_recipes/availability`,
    )

    await close()

    expect(ingestResponse.status).toBe(200)
    expect(secondIngestResponse.status).toBe(200)
    expect(await ingestResponse.json()).toEqual({ records: 1 })
    expect(exportResponse.status).toBe(200)
    expect(await exportResponse.json()).toMatchObject({
      next: {
        afterId: expect.any(String),
        updatedAfter: expect.any(Number),
      },
      records: [
        {
          count: 2,
          itemId: 700,
          key: 'v1|availability|33|700|6|0',
          observedFlagshipIds: [100, 101],
          observedSecondShipId: 0,
          recipeId: 33,
          sources: ['list'],
        },
      ],
    })
  })

  test('uses a strict updatedAfter boundary when no SQLite export ID is supplied', async () => {
    const { baseUrl, close } = await startSqliteServer()
    const observedAt = Date.UTC(2026, 6, 3, 15)
    await postReport(baseUrl, '/api/report/v3/item_improvement_recipe', {
      schemaVersion: 1,
      source: 'list',
      clientObservedAt: observedAt,
      recipeId: 33,
      itemId: 700,
      day: 6,
      observedSecondShipId: 0,
      observedFlagshipIds: [100],
    })
    const firstResponse = await fetch(
      `${baseUrl}/api/report/v3/item_improvement_recipes/availability`,
    )
    const firstBody = (await firstResponse.json()) as {
      next: { updatedAfter: number }
    }
    const boundaryResponse = await fetch(
      `${baseUrl}/api/report/v3/item_improvement_recipes/availability?updatedAfter=${firstBody.next.updatedAfter}`,
    )

    await close()

    expect(boundaryResponse.status).toBe(200)
    expect(await boundaryResponse.json()).toEqual({ next: null, records: [] })
  })

  test('rejects unsupported item improvement recipe sources in SQLite mode', async () => {
    const { baseUrl, close } = await startSqliteServer()

    const response = await postReport(baseUrl, '/api/report/v3/item_improvement_recipe', {
      schemaVersion: 1,
      source: 'unknown',
    })

    await close()

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'source: Invalid option: expected one of "list"|"detail"|"execution"',
    })
  })

  test('rejects unbounded SQLite item improvement exports', async () => {
    const { baseUrl, close } = await startSqliteServer()

    const response = await fetch(
      `${baseUrl}/api/report/v3/item_improvement_recipes/availability?limit=-1`,
    )

    await close()

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'limit: must be positive' })
  })

  test('uses compound cursor indexes for SQLite item improvement exports', async () => {
    const { operationalUrl, close } = await startSqliteServer()
    await close()
    const db = new Database(operationalUrl.replace(/^sqlite:\/\//, ''), { readonly: true })
    try {
      for (const table of [
        'item_improvement_availability_facts',
        'item_improvement_cost_facts',
        'item_improvement_update_facts',
      ]) {
        const plan = db
          .prepare(
            `
              EXPLAIN QUERY PLAN
              SELECT *
              FROM ${table}
              WHERE last_reported > ?
              ORDER BY last_reported, id
              LIMIT ?
            `,
          )
          .all(0, 500) as Array<{ detail: string }>

        expect(plan.map(({ detail }) => detail).join('\n')).toContain(
          `USING INDEX ${table}_export_idx`,
        )
      }
    } finally {
      db.close()
    }
  })

  test('ingests and exports item improvement cost and update facts in SQLite mode', async () => {
    mongoose.set('bufferTimeoutMS', 100)
    const { baseUrl, close } = await startSqliteServer()
    const observedAt = Date.UTC(2026, 6, 3, 15)

    const costResponse = await postReport(baseUrl, '/api/report/v3/item_improvement_recipe', {
      schemaVersion: 1,
      source: 'detail',
      clientObservedAt: observedAt,
      recipeId: 34,
      itemId: 701,
      day: 6,
      observedSecondShipId: 0,
      observedFlagshipIds: [100],
      itemLevel: 1,
      stage: 2,
      fuel: 10,
      ammo: 20,
      steel: 30,
      bauxite: 40,
      buildkit: 1,
      remodelkit: 2,
      certainBuildkit: 3,
      certainRemodelkit: 4,
      reqSlotItems: [{ id: 5, count: 1 }],
      reqUseItems: [{ id: 6, count: 2 }],
      changeFlag: 7,
    })
    const updateResponse = await postReport(baseUrl, '/api/report/v3/item_improvement_recipe', {
      schemaVersion: 1,
      source: 'execution',
      clientObservedAt: observedAt,
      recipeId: 35,
      itemId: 702,
      day: 6,
      observedSecondShipId: 0,
      observedFlagshipIds: [100],
      itemLevel: 9,
      upgradeObserved: true,
      upgradeToItemId: 703,
      upgradeToItemLevel: 0,
    })
    const costsExport = await fetch(`${baseUrl}/api/report/v3/item_improvement_recipes/costs`)
    const updatesExport = await fetch(`${baseUrl}/api/report/v3/item_improvement_recipes/updates`)

    await close()

    expect(costResponse.status).toBe(200)
    expect(updateResponse.status).toBe(200)
    expect(await costsExport.json()).toMatchObject({
      records: [
        {
          count: 1,
          changeFlag: 7,
          itemId: 701,
          itemLevel: 1,
          key: 'v1|cost|34|701|1|2|6|0|10|20|30|40|1|2|3|4|5:1|6:2|7',
          recipeId: 34,
          reqSlotItems: [{ id: 5, count: 1 }],
          reqUseItems: [{ id: 6, count: 2 }],
        },
      ],
    })
    expect(await updatesExport.json()).toMatchObject({
      records: [
        {
          count: 1,
          itemId: 702,
          itemLevel: 9,
          key: 'v1|update|35|702|9|6|0|703|0',
          recipeId: 35,
          upgradeToItemId: 703,
        },
      ],
    })
  })

  test('migrates legacy SQLite item improvement cost keys without splitting facts', async () => {
    const environment = await createTempSqliteEnvironment()
    const firstServer = await startSqliteServer(environment)
    const observedAt = Date.UTC(2026, 6, 3, 15)
    const costRecord = {
      schemaVersion: 1,
      source: 'detail',
      clientObservedAt: observedAt,
      recipeId: 34,
      itemId: 701,
      day: 6,
      observedSecondShipId: 0,
      observedFlagshipIds: [100],
      itemLevel: 1,
      stage: 2,
      fuel: 10,
      ammo: 20,
      steel: 30,
      bauxite: 40,
      buildkit: 1,
      remodelkit: 2,
      certainBuildkit: 3,
      certainRemodelkit: 4,
      reqSlotItems: [{ id: 5, count: 1 }],
      reqUseItems: [{ id: 6, count: 2 }],
      changeFlag: 7,
    }
    await postReport(firstServer.baseUrl, '/api/report/v3/item_improvement_recipe', costRecord)
    await firstServer.close()

    const db = new Database(environment.operationalUrl.replace(/^sqlite:\/\//, ''))
    try {
      db.prepare('UPDATE item_improvement_cost_facts SET key = ?').run(
        'v1|cost|34|701|1|2|6|0|10|20|30|40|1|2|3|4|[{"id":5,"count":1}]|[{"id":6,"count":2}]|7',
      )
    } finally {
      db.close()
    }

    const restarted = await startSqliteServer(environment)
    await postReport(restarted.baseUrl, '/api/report/v3/item_improvement_recipe', costRecord)
    const response = await fetch(
      `${restarted.baseUrl}/api/report/v3/item_improvement_recipes/costs`,
    )
    await restarted.close()

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      records: [
        {
          count: 2,
          key: 'v1|cost|34|701|1|2|6|0|10|20|30|40|1|2|3|4|5:1|6:2|7',
        },
      ],
    })
  })
})
