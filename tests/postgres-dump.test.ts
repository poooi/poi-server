import crypto from 'crypto'
import { mkdir, readFile, rm } from 'fs/promises'
import path from 'path'

import { and, eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

const postgresUrl = process.env.POI_TEST_POSTGRES_URL
const localPostgresHosts = new Set(['localhost', '127.0.0.1'])

const loadDumpModule = () => import('../src/db/dump')
const loadPostgresModule = () => import('../src/db/postgres')
const loadSchemaModule = () => import('../src/db/schema/postgres')

let e2eUnavailableReason: string | undefined
let closePostgresDb: Awaited<ReturnType<typeof loadPostgresModule>>['closePostgresDb']
let getPostgresDb: Awaited<ReturnType<typeof loadPostgresModule>>['getPostgresDb']
let runPostgresMigrations: Awaited<ReturnType<typeof loadPostgresModule>>['runPostgresMigrations']
let runMonthlyDump: Awaited<ReturnType<typeof loadDumpModule>>['runMonthlyDump']
let schema: Awaited<ReturnType<typeof loadSchemaModule>>

const dumpDir = path.resolve(__dirname, '.artifacts/postgres-dump')

const truncateSql = sql.raw(`
  TRUNCATE TABLE
    create_ship_records,
    create_item_records,
    remodel_item_records,
    drop_ship_records,
    pass_event_records,
    battle_apis,
    night_contacts,
    aaci_records,
    night_battle_cis,
    select_rank_records,
    recipe_records,
    ship_stats,
    enemy_infos,
    quests,
    quest_rewards,
    item_improvement_availability_facts,
    item_improvement_cost_facts,
    item_improvement_update_facts,
    data_dump_runs
  RESTART IDENTITY CASCADE
`)

const assertE2eDatabaseUri = (databaseUrl: string) => {
  const url = new URL(databaseUrl)
  const databaseName = url.pathname.replace(/^\/+/, '').split('?')[0]

  if (!databaseName.includes('poi_test') && !databaseName.includes('poi-e2e')) {
    throw new Error(
      `Refusing to run PostgreSQL e2e tests against non-e2e database: ${databaseName || '<none>'}`,
    )
  }
  if (!localPostgresHosts.has(url.hostname)) {
    throw new Error('Refusing to run PostgreSQL e2e tests against non-local host')
  }
}

const getChecksum = (contents: string) =>
  crypto.createHash('sha256').update(contents, 'utf8').digest('hex')

beforeAll(async () => {
  if (postgresUrl == null || postgresUrl === '') {
    e2eUnavailableReason = 'POI_TEST_POSTGRES_URL is not set'
    return
  }

  assertE2eDatabaseUri(postgresUrl)
  process.env.POI_TEST_POSTGRES_URL = postgresUrl
  process.env.POI_SERVER_DATABASE_URL = postgresUrl
  delete process.env.POI_SERVER_DB
  vi.resetModules()

  ;({ runMonthlyDump } = await loadDumpModule())
  ;({ closePostgresDb, getPostgresDb, runPostgresMigrations } = await loadPostgresModule())
  schema = await loadSchemaModule()

  await closePostgresDb()
  await runPostgresMigrations(postgresUrl)
})

beforeEach(async (ctx) => {
  if (e2eUnavailableReason != null) {
    ctx.skip(e2eUnavailableReason)
  }

  await rm(dumpDir, { recursive: true, force: true })
  await mkdir(dumpDir, { recursive: true })
  await getPostgresDb(postgresUrl as string).execute(truncateSql)
})

afterAll(async () => {
  await rm(dumpDir, { recursive: true, force: true })
  await closePostgresDb?.()
})

describe('monthly PostgreSQL dump and cleanup', () => {
  test('dumps closed-month append-heavy rows, records metadata, preserves stateful data, and is idempotent', async () => {
    const db = getPostgresDb(postgresUrl as string)
    const juneIngestedAt = new Date(Date.UTC(2026, 5, 15, 12, 0, 0))
    const julyIngestedAt = new Date(Date.UTC(2026, 6, 5, 12, 0, 0))

    await db.insert(schema.createShipRecords).values([
      {
        items: [10, 20, 30, 40],
        kdockId: 1,
        secretary: 100,
        shipId: 501,
        highspeed: 0,
        teitokuLv: 120,
        largeFlag: false,
        origin: 'Reporter 3.6.0',
        ingestedAt: juneIngestedAt,
        rawPayload: { source: 'june-create-ship' },
      },
      {
        items: [11, 21, 31, 41],
        kdockId: 2,
        secretary: 101,
        shipId: 502,
        highspeed: 1,
        teitokuLv: 121,
        largeFlag: true,
        origin: 'Reporter 3.7.0',
        ingestedAt: julyIngestedAt,
        rawPayload: { source: 'july-create-ship' },
      },
    ])

    await db.insert(schema.battleApis).values([
      {
        origin: 'Reporter 3.6.0',
        path: '/api_req_sortie/battle',
        data: { api_result: 1, month: 'june' },
        ingestedAt: juneIngestedAt,
        rawPayload: { source: 'june-battle-api' },
      },
      {
        origin: 'Reporter 3.6.0',
        path: '/api_req_sortie/night_battle',
        data: { api_result: 1, month: 'july' },
        ingestedAt: julyIngestedAt,
        rawPayload: { source: 'july-battle-api' },
      },
    ])

    await db.insert(schema.selectRankRecords).values({
      teitokuId: 'admiral-1',
      teitokuLv: 100,
      mapareaId: 6,
      rank: 1,
      origin: 'Reporter 3.6.0',
      rawPayload: { preserved: true },
    })

    const result = await runMonthlyDump(postgresUrl as string, {
      outputDir: dumpDir,
      referenceDate: new Date(Date.UTC(2026, 6, 10, 0, 0, 0)),
    })

    expect(result.dumpMonth).toBe('2026-06')
    expect(result.tables).toHaveLength(Object.keys(schema.dumpableAppendHeavyTables).length)
    expect(result.tables.every((table) => table.tableName !== 'select_rank_records')).toBe(true)

    const createShipDump = result.tables.find((table) => table.tableName === 'create_ship_records')
    const battleApiDump = result.tables.find((table) => table.tableName === 'battle_apis')
    expect(createShipDump).toMatchObject({
      tableName: 'create_ship_records',
      dumpMonth: '2026-06',
      status: 'dumped',
      rowCount: 1,
    })
    expect(battleApiDump).toMatchObject({
      tableName: 'battle_apis',
      dumpMonth: '2026-06',
      status: 'dumped',
      rowCount: 1,
    })

    const createShipContents = await readFile(
      path.join(dumpDir, 'create_ship_records_2026-06.jsonl'),
      'utf8',
    )
    const battleApiContents = await readFile(
      path.join(dumpDir, 'battle_apis_2026-06.jsonl'),
      'utf8',
    )
    expect(createShipContents.trimEnd().split('\n')).toHaveLength(1)
    expect(battleApiContents.trimEnd().split('\n')).toHaveLength(1)
    expect(getChecksum(createShipContents)).toBe(createShipDump?.checksum)
    expect(getChecksum(battleApiContents)).toBe(battleApiDump?.checksum)

    const dumpRuns = await db
      .select()
      .from(schema.dataDumpRuns)
      .where(
        and(
          eq(schema.dataDumpRuns.dumpMonth, '2026-06'),
          inArray(schema.dataDumpRuns.tableName, ['create_ship_records', 'battle_apis']),
        ),
      )
    expect(dumpRuns).toHaveLength(2)
    for (const run of dumpRuns) {
      expect(run.rowCount).toBe(1)
      expect(run.completedAt).toBeInstanceOf(Date)
      expect(run.cleanedUpAt).toBeInstanceOf(Date)
      expect(run.outputLocation).toMatch(/2026-06\.jsonl$/)
    }

    const createShips = await db.select().from(schema.createShipRecords)
    const battleApis = await db.select().from(schema.battleApis)
    const selectRanks = await db.select().from(schema.selectRankRecords)
    expect(createShips).toHaveLength(1)
    expect(createShips[0].shipId).toBe(502)
    expect(battleApis).toHaveLength(1)
    expect(battleApis[0].path).toBe('/api_req_sortie/night_battle')
    expect(selectRanks).toHaveLength(1)
    expect(selectRanks[0].teitokuId).toBe('admiral-1')

    const rerun = await runMonthlyDump(postgresUrl as string, {
      outputDir: dumpDir,
      referenceDate: new Date(Date.UTC(2026, 6, 10, 0, 0, 0)),
    })

    expect(rerun.tables.find((table) => table.tableName === 'create_ship_records')?.status).toBe(
      'skipped',
    )
    expect(rerun.tables.find((table) => table.tableName === 'battle_apis')?.status).toBe('skipped')
    expect(await db.select().from(schema.dataDumpRuns)).toHaveLength(2)
  })
})
