import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

const sentryMocks = vi.hoisted(() => ({
  addEventProcessor: vi.fn(),
  continueTrace: vi.fn((_headers, callback) => callback()),
  finish: vi.fn(),
  parseRequest: vi.fn((event) => event),
  setContext: vi.fn(),
  setHttpStatus: vi.fn(),
  setName: vi.fn(),
  setTags: vi.fn(),
  setUser: vi.fn(),
  startInactiveSpan: vi.fn(),
  withActiveSpan: vi.fn((_span, callback) => callback()),
  withScope: vi.fn(),
}))

const dfMock = vi.hoisted(() => vi.fn())

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

import childProcess from 'child_process'
import { asc, sql } from 'drizzle-orm'
import { type AddressInfo } from 'net'

const reporterOrigin = 'Reporter/8.1.0 poi/10.3.99'
const observedAt = Date.UTC(2026, 6, 3, 15)
const latestCommit = '0123456789abcdef0123456789abcdef01234567'
const postgresUrl = process.env.POI_TEST_POSTGRES_URL

interface TestResponse {
  body: unknown
  headers: Headers
  status: number
  text: string
}

const localPostgresHosts = new Set(['localhost', '127.0.0.1'])

let baseUrl: string
let closeServer: (() => Promise<void>) | undefined
let e2eUnavailableReason: string | undefined
let now = observedAt

const loadServerModule = () => import('../src/server')
const loadPostgresModule = () => import('../src/db/postgres')
const loadSchemaModule = () => import('../src/db/schema/postgres')

let startServer: Awaited<ReturnType<typeof loadServerModule>>['startServer']
let closePostgresDb: Awaited<ReturnType<typeof loadPostgresModule>>['closePostgresDb']
let getPostgresDb: Awaited<ReturnType<typeof loadPostgresModule>>['getPostgresDb']
let runPostgresMigrations: Awaited<ReturnType<typeof loadPostgresModule>>['runPostgresMigrations']
let schema: Awaited<ReturnType<typeof loadSchemaModule>>

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

const setupSentryMocks = () => {
  sentryMocks.startInactiveSpan.mockReturnValue({
    end: sentryMocks.finish,
    updateName: sentryMocks.setName,
  })
  sentryMocks.withScope.mockImplementation((callback) =>
    callback({
      addEventProcessor: sentryMocks.addEventProcessor,
      setContext: sentryMocks.setContext,
      setTags: sentryMocks.setTags,
      setUser: sentryMocks.setUser,
    }),
  )
}

const request = async (
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<TestResponse> => {
  const requestHeaders: Record<string, string> = {
    accept: 'application/json',
    ...headers,
  }
  let requestBody: string | undefined
  if (body !== undefined) {
    requestHeaders['content-type'] = 'application/json'
    requestBody = JSON.stringify(body)
  }

  const response = await fetch(`${baseUrl}${path}`, {
    body: requestBody,
    headers: requestHeaders,
    method,
  })
  const text = await response.text()
  const contentType = response.headers.get('content-type') || ''

  return {
    body: contentType.includes('application/json') && text ? JSON.parse(text) : text,
    headers: response.headers,
    status: response.status,
    text,
  }
}

const getReportHeaders = (headers: Record<string, string> = {}) => ({
  'x-reporter': reporterOrigin,
  ...headers,
})

const postReport = (
  path: string,
  data: unknown,
  headers?: Record<string, string>,
): Promise<TestResponse> => request('POST', path, { data }, getReportHeaders(headers))

const createShipPayload = {
  items: [30, 30, 30, 30],
  kdockId: 1,
  secretary: 100,
  shipId: 101,
  highspeed: 0,
  teitokuLv: 120,
  largeFlag: false,
}

const itemImprovementRecords = [
  {
    schemaVersion: 1,
    source: 'list',
    clientObservedAt: observedAt,
    recipeId: 33,
    itemId: 700,
    day: 6,
    observedSecondShipId: 0,
    observedFlagshipId: 101,
  },
  {
    schemaVersion: 1,
    source: 'detail',
    clientObservedAt: observedAt,
    recipeId: 33,
    itemId: 700,
    itemLevel: 6,
    stage: 1,
    day: 6,
    observedSecondShipId: 0,
    observedFlagshipId: 101,
    fuel: 10,
    ammo: 20,
    steel: 30,
    bauxite: 40,
    buildkit: 3,
    remodelkit: 4,
    certainBuildkit: 5,
    certainRemodelkit: 6,
    reqSlotItems: [{ id: 90, count: 2 }],
    reqUseItems: [{ id: 65, count: 1 }],
    changeFlag: 0,
    futureField: { nested: true },
  },
  {
    schemaVersion: 1,
    source: 'execution',
    clientObservedAt: observedAt,
    recipeId: 33,
    itemId: 700,
    itemLevel: 10,
    day: 6,
    observedSecondShipId: 102,
    observedFlagshipId: 101,
    upgradeObserved: true,
    upgradeToItemId: 701,
    upgradeToItemLevel: 0,
  },
]

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

  ;({ startServer } = await loadServerModule())
  ;({ closePostgresDb, getPostgresDb, runPostgresMigrations } = await loadPostgresModule())
  schema = await loadSchemaModule()

  await closePostgresDb()
  await runPostgresMigrations(postgresUrl)

  const started = await startServer({
    db: postgresUrl,
    disableLogger: true,
    host: '127.0.0.1',
    loadLatestCommit: false,
    port: 0,
  })
  closeServer = started.close
  const address = started.server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${address.port}`
})

beforeEach(async (ctx) => {
  if (e2eUnavailableReason != null) {
    ctx.skip(e2eUnavailableReason)
  }

  now = observedAt
  setupSentryMocks()
  dfMock.mockResolvedValue([
    {
      filesystem: 'memory',
      mountpoint: '/',
      size: 1024,
      used: 256,
      available: 768,
      capacity: 25,
    },
  ])
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  global.latestCommit = latestCommit
  await getPostgresDb(postgresUrl as string).execute(truncateSql)
})

afterEach(() => {
  vi.restoreAllMocks()
})

afterAll(async () => {
  await closeServer?.()
  await closePostgresDb?.()
})

describe('server common endpoints', () => {
  test('reports service status using the live PostgreSQL database', async () => {
    expect((await postReport('/api/report/v2/create_ship', createShipPayload)).status).toBe(200)
    expect(
      (
        await postReport('/api/report/v2/create_item', {
          items: [10, 20, 30, 40],
          secretary: 100,
          itemId: 15,
          teitokuLv: 120,
          successful: true,
        })
      ).status,
    ).toBe(200)

    const response = await request('GET', '/api/status')

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      env: process.env.NODE_ENV,
      disk: [{ mountpoint: '/' }],
      mongo: {
        CreateShipRecord: 1,
        CreateItemRecord: 1,
      },
      database: {
        backend: 'postgres',
        counts: {
          CreateShipRecord: 1,
          CreateItemRecord: 1,
        },
      },
    })
  })

  test('starts the GitHub master hook process and returns success', async () => {
    const spawn = vi.spyOn(childProcess, 'spawn').mockReturnValue({
      on: vi.fn(),
      stderr: { on: vi.fn() },
      stdout: { on: vi.fn() },
    } as any)

    const response = await request('POST', '/api/github-master-hook', {})

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ code: 0 })
    expect(spawn).toHaveBeenCalledWith(expect.stringContaining('github-master-hook'), [])
  })

  test('returns latest commit and generated service badges', async () => {
    const latestCommitResponse = await request('GET', '/api/latest-commit')
    const statusBadgeResponse = await request('GET', '/api/service-status-badge')
    const versionBadgeResponse = await request('GET', '/api/service-version-badge')

    expect(latestCommitResponse.status).toBe(200)
    expect(latestCommitResponse.body).toBe(latestCommit)
    expect(statusBadgeResponse.status).toBe(200)
    expect(statusBadgeResponse.headers.get('content-type')).toContain('image/svg+xml')
    expect(statusBadgeResponse.text).toContain('service')
    expect(statusBadgeResponse.text).toContain('up')
    expect(versionBadgeResponse.status).toBe(200)
    expect(versionBadgeResponse.headers.get('content-type')).toContain('image/svg+xml')
    expect(versionBadgeResponse.text).toContain(latestCommit.slice(0, 8))
  })

  test('preserves not-found behavior for unknown routes and unsupported methods', async () => {
    const notFoundResponse = await request('GET', '/api/not-found')
    const unsupportedMethodResponse = await request('PUT', '/api/status')

    expect(notFoundResponse.status).toBe(404)
    expect(unsupportedMethodResponse.status).toBe(404)
  })
})

describe('v2 report endpoints', () => {
  test('persists append-only report records through HTTP requests', async () => {
    const cases = [
      {
        path: '/api/report/v2/create_ship',
        table: schema.createShipRecords,
        payload: { ...createShipPayload, futureField: { nested: true } },
        expected: { shipId: 101, origin: reporterOrigin, largeFlag: false },
        assertRow: (row: Record<string, any>) => {
          expect(row.rawPayload).toMatchObject({ futureField: { nested: true } })
        },
      },
      {
        path: '/api/report/v2/create_item',
        table: schema.createItemRecords,
        payload: {
          items: [10, 20, 30, 40],
          secretary: 100,
          itemId: 15,
          teitokuLv: 120,
          successful: true,
        },
        expected: { itemId: 15, origin: reporterOrigin, successful: true },
      },
      {
        path: '/api/report/v2/remodel_item',
        table: schema.remodelItemRecords,
        payload: {
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
        },
        expected: { itemId: 200, successful: true },
      },
      {
        path: '/api/report/v2/pass_event',
        table: schema.passEventRecords,
        payload: {
          teitokuId: 'admiral-1',
          teitokuLv: 120,
          mapId: 502,
          mapLv: 3,
          rewards: [{ rewardType: 1, rewardId: 2, rewardCount: 3, rewardLevel: 0 }],
        },
        expected: { mapId: 502, origin: reporterOrigin },
      },
      {
        path: '/api/report/v2/battle_api',
        table: schema.battleApis,
        payload: {
          path: '/kcsapi/api_req_sortie/battle',
          data: { api_result: 1 },
        },
        expected: { path: '/kcsapi/api_req_sortie/battle', origin: reporterOrigin },
      },
      {
        path: '/api/report/v2/night_contcat',
        table: schema.nightContacts,
        payload: {
          fleetType: 1,
          shipId: 100,
          shipLv: 90,
          itemId: 102,
          itemLv: 3,
          contact: true,
        },
        expected: { shipId: 100, contact: true },
      },
      {
        path: '/api/report/v2/night_battle_ci',
        table: schema.nightBattleCis,
        payload: {
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
          time: observedAt,
        },
        expected: { shipId: 100, origin: reporterOrigin, time: observedAt },
      },
    ]

    const db = getPostgresDb(postgresUrl as string)

    for (const item of cases) {
      const response = await postReport(item.path, item.payload)

      expect(response.status).toBe(200)
      const rows = await db.select().from(item.table)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject(item.expected)
      item.assertRow?.(rows[0] as Record<string, any>)
      await db.execute(truncateSql)
    }
  })

  test('normalizes drop ship snapshots only for non-late maps', async () => {
    const earlyMapResponse = await postReport('/api/report/v2/drop_ship', {
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
    const lateMapResponse = await postReport('/api/report/v2/drop_ship', {
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

    const records = await getPostgresDb(postgresUrl as string)
      .select()
      .from(schema.dropShipRecords)
      .orderBy(asc(schema.dropShipRecords.shipId))

    expect(earlyMapResponse.status).toBe(200)
    expect(lateMapResponse.status).toBe(200)
    expect(records).toHaveLength(2)
    expect(records[0].ownedShipSnapshot).toEqual({})
    expect(records[1].ownedShipSnapshot).toEqual({ 1: [100] })
  })

  test('gates AACI persistence by poi and reporter versions', async () => {
    const eligibleResponse = await postReport(
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
      { 'x-reporter': 'Reporter 3.6.0' },
    )
    const ineligibleResponse = await postReport(
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
      { 'x-reporter': 'Reporter 3.6.0' },
    )

    const records = await getPostgresDb(postgresUrl as string)
      .select()
      .from(schema.aaciRecords)

    expect(eligibleResponse.status).toBe(200)
    expect(ineligibleResponse.status).toBe(200)
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      origin: 'Reporter 3.6.0',
      poiVersion: '7.9.2',
    })
  })

  test('upserts select rank, remodel recipes, ship stats, and enemy info', async () => {
    const db = getPostgresDb(postgresUrl as string)

    expect(
      (
        await postReport('/api/report/v2/select_rank', {
          teitokuId: 'admiral-1',
          teitokuLv: 100,
          mapareaId: 5,
          rank: 1,
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await postReport('/api/report/v2/select_rank', {
          teitokuId: 'admiral-1',
          teitokuLv: 120,
          mapareaId: 5,
          rank: 3,
        })
      ).status,
    ).toBe(200)

    const remodelRecipePayload = {
      recipeId: 33,
      itemId: 700,
      stage: 1,
      day: 6,
      secretary: 100,
      fuel: 10,
      ammo: 20,
      steel: 30,
      bauxite: 40,
      reqItemId: 90,
      reqItemCount: 2,
      buildkit: 3,
      remodelkit: 4,
      certainBuildkit: 5,
      certainRemodelkit: 6,
      upgradeToItemId: 701,
      upgradeToItemLevel: 0,
    }
    expect((await postReport('/api/report/v2/remodel_recipe', remodelRecipePayload)).status).toBe(
      200,
    )
    expect((await postReport('/api/report/v2/remodel_recipe', remodelRecipePayload)).status).toBe(
      200,
    )
    expect(
      (
        await postReport('/api/report/v2/remodel_recipe', {
          ...remodelRecipePayload,
          recipeId: 34,
          stage: -1,
        })
      ).status,
    ).toBe(200)

    const shipStatPayload = {
      id: 100,
      lv: 99,
      los: 80,
      los_max: 90,
      asw: 70,
      asw_max: 80,
      evasion: 100,
      evasion_max: 110,
    }
    expect((await postReport('/api/report/v2/ship_stat', shipStatPayload)).status).toBe(200)
    expect((await postReport('/api/report/v2/ship_stat', shipStatPayload)).status).toBe(200)

    const enemyPayload = {
      ships1: [1, 2],
      levels1: [1, 1],
      hp1: [10, 10],
      stats1: [[1], [2]],
      equips1: [[3], [4]],
      ships2: [],
      levels2: [],
      hp2: [],
      stats2: [],
      equips2: [],
      planes: 10,
      bombersMin: 5,
      bombersMax: 10,
    }
    expect((await postReport('/api/report/v2/enemy_info', enemyPayload)).status).toBe(200)
    expect(
      (
        await postReport('/api/report/v2/enemy_info', {
          ...enemyPayload,
          bombersMin: 7,
          bombersMax: 8,
        })
      ).status,
    ).toBe(200)

    const [rankRecord] = await db.select().from(schema.selectRankRecords)
    const recipeRecords = await db.select().from(schema.recipeRecords)
    const [shipStatRecord] = await db.select().from(schema.shipStats)
    const [enemyInfoRecord] = await db.select().from(schema.enemyInfos)

    expect(rankRecord).toMatchObject({
      teitokuId: 'admiral-1',
      mapareaId: 5,
      rank: 3,
      teitokuLv: 120,
      origin: reporterOrigin,
    })
    expect(recipeRecords).toHaveLength(1)
    expect(recipeRecords[0]).toMatchObject({ count: 2, origin: reporterOrigin, stage: 1 })
    expect(typeof recipeRecords[0].lastReported).toBe('number')
    expect(shipStatRecord).toMatchObject({ shipId: 100, count: 2 })
    expect(typeof shipStatRecord.lastTimestamp).toBe('number')
    expect(enemyInfoRecord).toMatchObject({
      bombersMin: 7,
      bombersMax: 8,
      count: 2,
    })
  })

  test('keeps compatibility routes aligned with PostgreSQL behavior', async () => {
    await getPostgresDb(postgresUrl as string)
      .insert(schema.quests)
      .values([
        {
          key: 'quest-b',
          questId: 2,
          title: 'B',
          detail: 'B detail',
          category: 1,
          type: 1,
          origin: reporterOrigin,
          rawPayload: { questId: 2 },
        },
        {
          key: 'quest-c',
          questId: 10,
          title: 'C',
          detail: 'C detail',
          category: 1,
          type: 1,
          origin: reporterOrigin,
          rawPayload: { questId: 10 },
        },
        {
          key: 'quest-a',
          questId: 1,
          title: 'A',
          detail: 'A detail',
          category: 1,
          type: 1,
          origin: reporterOrigin,
          rawPayload: { questId: 1 },
        },
      ])

    const knownQuestsResponse = await request('GET', '/api/report/v2/known_quests')
    const knownRecipesResponse = await request('GET', '/api/report/v2/known_recipes')
    const questNoopResponse = await postReport('/api/report/v2/quest/1', { ignored: true })
    const dedupeResponse = await request('POST', '/api/report/v2/remodel_recipe_deduplicate', {})
    const nightBattleSsCiResponse = await postReport('/api/report/v2/night_battle_ss_ci', {
      ignored: true,
    })

    expect(knownQuestsResponse.status).toBe(200)
    expect(knownQuestsResponse.body).toEqual({ quests: [1, 10, 2] })
    expect(knownRecipesResponse.status).toBe(200)
    expect(knownRecipesResponse.body).toEqual({ recipes: [] })
    expect(questNoopResponse.status).toBe(200)
    expect(dedupeResponse.status).toBe(200)
    expect(dedupeResponse.body).toEqual({ recipes: [] })
    expect(nightBattleSsCiResponse.status).toBe(200)
    expect(
      await getPostgresDb(postgresUrl as string)
        .select()
        .from(schema.nightBattleCis),
    ).toHaveLength(0)
  })

  test('returns 400 for malformed and non-object report payloads', async () => {
    const malformedResponse = await postReport('/api/report/v2/create_ship', '{')
    const nonObjectResponse = await postReport('/api/report/v2/create_ship', 1)

    expect(malformedResponse.status).toBe(400)
    expect(malformedResponse.body).toEqual({ error: 'data must be valid JSON' })
    expect(nonObjectResponse.status).toBe(400)
    expect(nonObjectResponse.body).toEqual({ error: 'data must be a JSON object' })
    expect(
      await getPostgresDb(postgresUrl as string)
        .select()
        .from(schema.createShipRecords),
    ).toHaveLength(0)
  })
})

describe('v3 report endpoints', () => {
  test('ingests item improvement facts and exports every fact type', async () => {
    const ingestResponse = await postReport('/api/report/v3/item_improvement_recipe', {
      records: itemImprovementRecords,
    })

    now = observedAt + 5_000
    const availabilityResponse = await request(
      'GET',
      '/api/report/v3/item_improvement_recipes/availability?updatedAfter=0&limit=5000',
    )
    const costsResponse = await request('GET', '/api/report/v3/item_improvement_recipes/costs')
    const updatesResponse = await request('GET', '/api/report/v3/item_improvement_recipes/updates')

    const [availabilityFact] = await getPostgresDb(postgresUrl as string)
      .select()
      .from(schema.itemImprovementAvailabilityFacts)
    const [costFact] = await getPostgresDb(postgresUrl as string)
      .select()
      .from(schema.itemImprovementCostFacts)
    const [updateFact] = await getPostgresDb(postgresUrl as string)
      .select()
      .from(schema.itemImprovementUpdateFacts)

    expect(ingestResponse.status).toBe(200)
    expect(ingestResponse.body).toEqual({ records: 3 })
    expect(availabilityFact).toBeDefined()
    expect(costFact).toBeDefined()
    expect(updateFact).toBeDefined()
    expect(costFact.rawPayload).toMatchObject({ futureField: { nested: true } })
    expect(availabilityResponse.status).toBe(200)
    expect(availabilityResponse.body).toMatchObject({
      next: {
        updatedAfter: observedAt,
        afterId: expect.any(String),
      },
      records: [
        {
          key: 'v1|availability|33|700|6|0',
          count: 1,
          sources: ['list'],
        },
      ],
    })
    expect(
      (availabilityResponse.body as { records: Array<Record<string, unknown>> }).records[0],
    ).not.toHaveProperty('origins')
    expect(costsResponse.status).toBe(200)
    expect(costsResponse.body).toMatchObject({
      records: [
        {
          key: 'v1|cost|33|700|6|1|6|0|10|20|30|40|3|4|5|6|90:2|65:1|0',
        },
      ],
    })
    expect(
      (costsResponse.body as { records: Array<Record<string, unknown>> }).records[0],
    ).not.toHaveProperty('futureField')
    expect(
      (costsResponse.body as { records: Array<Record<string, unknown>> }).records[0],
    ).not.toHaveProperty('rawPayload')
    expect(
      typeof (costsResponse.body as { records: Array<Record<string, number>> }).records[0]
        .lastReported,
    ).toBe('number')
    expect(updatesResponse.status).toBe(200)
    expect(updatesResponse.body).toMatchObject({
      records: [
        {
          key: 'v1|update|33|700|10|6|102|701|0',
        },
      ],
    })
  })

  test('exports item improvement facts with default limits, clamping, ordering, and cursors', async () => {
    const db = getPostgresDb(postgresUrl as string)
    const seeded = Array.from({ length: 1005 }, (_, index) => ({
      key: `v1|availability|${index + 1}|700|6|0`,
      schemaVersion: 1,
      recipeId: index + 1,
      itemId: 700,
      day: 6,
      firstClientObservedAt: observedAt + index,
      lastClientObservedAt: observedAt + index,
      observedSecondShipId: 0,
      observedFlagshipIds: [101],
      sources: ['list'],
      origins: [reporterOrigin],
      firstReported: observedAt + index,
      lastReported: observedAt + index,
      count: 1,
      rawPayload: { recipeId: index + 1 },
    }))
    await db.insert(schema.itemImprovementAvailabilityFacts).values(seeded)

    now = observedAt + 10_000
    const defaultPage = await request(
      'GET',
      '/api/report/v3/item_improvement_recipes/availability?updatedAfter=0',
    )
    const clampedPage = await request(
      'GET',
      '/api/report/v3/item_improvement_recipes/availability?updatedAfter=0&limit=5000',
    )
    const firstPage = await request(
      'GET',
      '/api/report/v3/item_improvement_recipes/availability?updatedAfter=0&limit=2',
    )
    const firstPageBody = firstPage.body as {
      records: Array<Record<string, any>>
      next: { updatedAfter: number; afterId: string } | null
    }
    const secondPage = await request(
      'GET',
      `/api/report/v3/item_improvement_recipes/availability?updatedAfter=${firstPageBody.next?.updatedAfter}&afterId=${firstPageBody.next?.afterId}&limit=2`,
    )

    expect(defaultPage.status).toBe(200)
    expect((defaultPage.body as { records: unknown[] }).records).toHaveLength(500)
    expect((clampedPage.body as { records: unknown[] }).records).toHaveLength(1000)
    expect(firstPage.status).toBe(200)
    expect(secondPage.status).toBe(200)
    expect(firstPageBody.records).toHaveLength(2)
    expect((secondPage.body as { records: unknown[] }).records).toHaveLength(2)
    expect(firstPageBody.records[0]._id < firstPageBody.records[1]._id).toBe(true)
    expect(firstPageBody.records[0].recipeId).toBe(1)
    expect(firstPageBody.records[1].recipeId).toBe(2)
    expect(typeof firstPageBody.records[0].lastReported).toBe('number')
    expect(typeof firstPageBody.records[0].firstClientObservedAt).toBe('number')
    expect(firstPageBody.records[0]).not.toHaveProperty('origins')
    expect(firstPageBody.records[0]).not.toHaveProperty('rawPayload')
    expect(firstPageBody.next).toEqual({
      updatedAfter: firstPageBody.records[1].lastReported,
      afterId: firstPageBody.records[1]._id,
    })
  })

  test('uses a settled export window and same-timestamp afterId pagination without skips', async () => {
    const db = getPostgresDb(postgresUrl as string)
    const sameTimestamp = observedAt

    await db.insert(schema.itemImprovementAvailabilityFacts).values([
      {
        exportSequence: 2,
        key: 'v1|availability|34|700|6|0',
        schemaVersion: 1,
        recipeId: 34,
        itemId: 700,
        day: 6,
        firstClientObservedAt: sameTimestamp,
        lastClientObservedAt: sameTimestamp,
        observedSecondShipId: 0,
        observedFlagshipIds: [101],
        sources: ['list'],
        origins: [reporterOrigin],
        firstReported: sameTimestamp,
        lastReported: sameTimestamp,
        count: 1,
        rawPayload: { recipeId: 34 },
      },
      {
        exportSequence: 1,
        key: 'v1|availability|33|700|6|0',
        schemaVersion: 1,
        recipeId: 33,
        itemId: 700,
        day: 6,
        firstClientObservedAt: sameTimestamp,
        lastClientObservedAt: sameTimestamp,
        observedSecondShipId: 0,
        observedFlagshipIds: [101],
        sources: ['list'],
        origins: [reporterOrigin],
        firstReported: sameTimestamp,
        lastReported: sameTimestamp,
        count: 1,
        rawPayload: { recipeId: 33 },
      },
    ])

    now = sameTimestamp + 1_000
    const unsettledPage = await request(
      'GET',
      '/api/report/v3/item_improvement_recipes/availability?updatedAfter=0&limit=1',
    )
    expect(unsettledPage.status).toBe(200)
    expect(unsettledPage.body).toEqual({ records: [], next: null })

    now = sameTimestamp + 5_000
    const firstPage = await request(
      'GET',
      '/api/report/v3/item_improvement_recipes/availability?updatedAfter=0&limit=1',
    )
    const firstPageBody = firstPage.body as {
      records: Array<Record<string, any>>
      next: { updatedAfter: number; afterId: string }
    }
    const secondPage = await request(
      'GET',
      `/api/report/v3/item_improvement_recipes/availability?updatedAfter=${firstPageBody.next.updatedAfter}&afterId=${firstPageBody.next.afterId}&limit=1`,
    )
    const secondPageBody = secondPage.body as {
      records: Array<Record<string, any>>
      next: { updatedAfter: number; afterId: string }
    }

    expect(firstPageBody.records[0]._id).toBe('000000000000000000000001')
    expect(secondPageBody.records[0]._id).toBe('000000000000000000000002')
    expect(
      [...firstPageBody.records, ...secondPageBody.records].map((record) => record.key),
    ).toEqual(['v1|availability|33|700|6|0', 'v1|availability|34|700|6|0'])
  })

  test('upserts quests, exposes known quest prefixes, and stores insert-only quest rewards', async () => {
    const db = getPostgresDb(postgresUrl as string)
    const firstQuestPayload = {
      quests: [
        {
          questId: 801,
          category: 2,
          type: 1,
          title: 'Test quest',
          detail: 'Test details',
        },
      ],
    }

    const questResponse = await postReport(
      '/api/report/v3/quest',
      JSON.stringify(firstQuestPayload),
    )
    const duplicateQuestResponse = await postReport(
      '/api/report/v3/quest',
      JSON.stringify({
        quests: [
          {
            questId: 801,
            category: 2,
            type: 9,
            title: 'Test quest',
            detail: 'Test details',
          },
        ],
      }),
    )
    const knownQuestsResponse = await request('GET', '/api/report/v3/known_quests')
    const rewardResponse = await postReport('/api/report/v3/quest_reward', {
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
    const duplicateRewardResponse = await postReport('/api/report/v3/quest_reward', {
      questId: 901,
      title: 'Reward quest',
      detail: 'Reward details',
      category: 2,
      type: 9,
      selections: [1],
      material: [9, 9, 9, 9],
      bonus: [{ type: 'item', id: 1 }],
      bounsCount: 1,
    })
    const distinctRewardResponse = await postReport('/api/report/v3/quest_reward', {
      questId: 901,
      title: 'Reward quest',
      detail: 'Reward details',
      category: 2,
      type: 1,
      selections: [1],
      material: [0, 0, 0, 0],
      bonus: [{ type: 'item', id: 1 }],
      bounsCount: 2,
    })

    const [questRecord] = await db.select().from(schema.quests)
    const rewardRecords = await db
      .select()
      .from(schema.questRewards)
      .orderBy(asc(schema.questRewards.bonusCount))

    expect(questResponse.status).toBe(200)
    expect(duplicateQuestResponse.status).toBe(200)
    expect(questRecord).toMatchObject({
      questId: 801,
      title: 'Test quest',
      detail: 'Test details',
      type: 1,
      origin: reporterOrigin,
    })
    expect(knownQuestsResponse.status).toBe(200)
    expect(knownQuestsResponse.body).toEqual({ quests: [questRecord.key.slice(0, 8)] })
    expect(rewardResponse.status).toBe(200)
    expect(duplicateRewardResponse.status).toBe(200)
    expect(distinctRewardResponse.status).toBe(200)
    expect(rewardRecords).toHaveLength(2)
    expect(rewardRecords.map((record) => record.bonusCount)).toEqual([1, 2])
    expect(rewardRecords[0]).toMatchObject({
      title: 'Reward quest',
      material: [0, 0, 0, 0],
      bonusCount: 1,
      type: 1,
      origin: reporterOrigin,
    })
    expect(rewardRecords[0].rawPayload).toMatchObject({ bounsCount: 1 })
  })

  test('returns 400 for invalid item improvement payloads, cursors, and malformed JSON', async () => {
    const malformedResponse = await postReport('/api/report/v3/item_improvement_recipe', '{')
    const invalidRecordResponse = await postReport('/api/report/v3/item_improvement_recipe', {
      ...itemImprovementRecords[1],
      reqUseItems: [{ id: 65, count: 0 }],
    })
    const oversizedBatchResponse = await postReport('/api/report/v3/item_improvement_recipe', {
      records: Array.from({ length: 101 }, () => itemImprovementRecords[0]),
    })
    const invalidCursorResponse = await request(
      'GET',
      '/api/report/v3/item_improvement_recipes/availability?afterId=invalid-object-id',
    )
    const malformedQuestResponse = await postReport('/api/report/v3/quest', '{')
    const missingQuestResponse = await request(
      'POST',
      '/api/report/v3/quest',
      {},
      getReportHeaders(),
    )

    expect(malformedResponse.status).toBe(400)
    expect(malformedResponse.body).toEqual({ error: 'data must be valid JSON' })
    expect(invalidRecordResponse.status).toBe(400)
    expect(invalidRecordResponse.body).toEqual({
      error: 'reqUseItems.0: must contain positive id and count',
    })
    expect(oversizedBatchResponse.status).toBe(400)
    expect(oversizedBatchResponse.body).toEqual({
      error: 'records: Too big: expected array to have <=100 items',
    })
    expect(invalidCursorResponse.status).toBe(400)
    expect(invalidCursorResponse.body).toEqual({ error: 'afterId: must be a valid ObjectId' })
    expect(malformedQuestResponse.status).toBe(400)
    expect(malformedQuestResponse.body).toEqual({ error: 'data must be valid JSON' })
    expect(missingQuestResponse.status).toBe(400)
    expect(missingQuestResponse.body).toEqual({ error: 'data must be a JSON object' })
  })
})
