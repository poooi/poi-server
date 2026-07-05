import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

const sentryMocks = vi.hoisted(() => ({
  finish: vi.fn(),
  parseRequest: vi.fn((event) => event),
  setContext: vi.fn(),
  setHttpStatus: vi.fn(),
  setName: vi.fn(),
  setTags: vi.fn(),
  setUser: vi.fn(),
  startTransaction: vi.fn(),
  withScope: vi.fn(),
}))

const dfMock = vi.hoisted(() => vi.fn())

vi.mock('@sentry/node', () => ({
  startTransaction: sentryMocks.startTransaction,
  withScope: sentryMocks.withScope,
  captureException: vi.fn(),
  Handlers: {
    parseRequest: sentryMocks.parseRequest,
  },
}))

vi.mock('@sentry/tracing', () => ({
  extractTraceparentData: vi.fn(),
  stripUrlQueryAndFragment: vi.fn((url: string) => url.split('?')[0]),
}))

vi.mock('@sindresorhus/df', () => ({
  default: dfMock,
}))

import childProcess from 'child_process'
import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { type AddressInfo } from 'net'

import { startServer } from '../src/server'
import {
  AACIRecord,
  BattleAPI,
  CreateItemRecord,
  CreateShipRecord,
  DropShipRecord,
  EnemyInfo,
  ItemImprovementRecipeAvailabilityFact,
  ItemImprovementRecipeCostFact,
  ItemImprovementRecipeUpdateFact,
  NightBattleCI,
  NightContactRecord,
  PassEventRecord,
  Quest,
  QuestReward,
  RecipeRecord,
  RemodelItemRecord,
  SelectRankRecord,
  ShipStat,
} from '../src/models'

const reporterOrigin = 'Reporter/8.1.0 poi/10.3.99'
const observedAt = Date.UTC(2026, 6, 3, 15)
const latestCommit = '0123456789abcdef0123456789abcdef01234567'

interface TestResponse {
  body: unknown
  headers: Headers
  status: number
  text: string
}

let baseUrl: string
let mongo: MongoMemoryServer | undefined
let closeServer: (() => Promise<void>) | undefined

const setupSentryMocks = () => {
  sentryMocks.startTransaction.mockReturnValue({
    finish: sentryMocks.finish,
    setHttpStatus: sentryMocks.setHttpStatus,
    setName: sentryMocks.setName,
  })
  sentryMocks.withScope.mockImplementation((callback) =>
    callback({
      setContext: sentryMocks.setContext,
      setTags: sentryMocks.setTags,
      setUser: sentryMocks.setUser,
    }),
  )
}

const clearMongo = async () => {
  await Promise.all(
    Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({})),
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
  let db = process.env.POI_SERVER_DB
  if (db == null || db === '') {
    mongo = await MongoMemoryServer.create()
    db = mongo.getUri()
  }

  const started = await startServer({
    db,
    disableLogger: true,
    host: '127.0.0.1',
    loadLatestCommit: false,
    port: 0,
  })
  closeServer = started.close
  const address = started.server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${address.port}`
})

beforeEach(async () => {
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
  vi.spyOn(Date, 'now').mockReturnValue(observedAt)
  global.latestCommit = latestCommit
  await clearMongo()
})

afterEach(() => {
  vi.restoreAllMocks()
})

afterAll(async () => {
  await closeServer?.()
  await mongoose.disconnect()
  await mongo?.stop()
})

describe('server common endpoints', () => {
  test('reports service status using the live database', async () => {
    await CreateShipRecord.create({ ...createShipPayload, origin: reporterOrigin })

    const response = await request('GET', '/api/status')

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      mongo: {
        CreateShipRecord: 1,
        CreateItemRecord: 0,
      },
    })
    expect(response.body).toMatchObject({
      env: process.env.NODE_ENV,
      disk: [
        {
          mountpoint: '/',
        },
      ],
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
  test('persists simple report records through HTTP requests', async () => {
    const cases = [
      {
        path: '/api/report/v2/create_ship',
        model: CreateShipRecord,
        payload: createShipPayload,
        expected: { shipId: 101, origin: reporterOrigin },
      },
      {
        path: '/api/report/v2/create_item',
        model: CreateItemRecord,
        payload: {
          items: [10, 20, 30, 40],
          secretary: 100,
          itemId: 15,
          teitokuLv: 120,
          successful: true,
        },
        expected: { itemId: 15, origin: reporterOrigin },
      },
      {
        path: '/api/report/v2/remodel_item',
        model: RemodelItemRecord,
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
        model: PassEventRecord,
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
        model: BattleAPI,
        payload: {
          path: '/kcsapi/api_req_sortie/battle',
          data: { api_result: 1 },
        },
        expected: { path: '/kcsapi/api_req_sortie/battle', origin: reporterOrigin },
      },
      {
        path: '/api/report/v2/night_contcat',
        model: NightContactRecord,
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
        model: NightBattleCI,
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
        expected: { shipId: 100, origin: reporterOrigin },
      },
    ]

    for (const item of cases) {
      const response = await postReport(item.path, item.payload)

      expect(response.status).toBe(200)
      expect(await item.model.countDocuments().exec()).toBe(1)
      expect(await item.model.findOne(item.expected).lean().exec()).toMatchObject(item.expected)
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

    const earlyMapRecord = (await DropShipRecord.findOne({ shipId: 1 }).lean().exec()) as any
    const lateMapRecord = (await DropShipRecord.findOne({ shipId: 2 }).lean().exec()) as any

    expect(earlyMapResponse.status).toBe(200)
    expect(lateMapResponse.status).toBe(200)
    expect(earlyMapRecord.ownedShipSnapshot).toBeUndefined()
    expect(lateMapRecord.ownedShipSnapshot).toEqual({ 1: [100] })
  })

  test('upserts select rank records by admiral and map area', async () => {
    const firstResponse = await postReport('/api/report/v2/select_rank', {
      teitokuId: 'admiral-1',
      teitokuLv: 100,
      mapareaId: 5,
      rank: 1,
    })
    const secondResponse = await postReport('/api/report/v2/select_rank', {
      teitokuId: 'admiral-1',
      teitokuLv: 120,
      mapareaId: 5,
      rank: 3,
    })

    const record = await SelectRankRecord.findOne({ teitokuId: 'admiral-1', mapareaId: 5 })
      .lean()
      .exec()

    expect(firstResponse.status).toBe(200)
    expect(secondResponse.status).toBe(200)
    expect(await SelectRankRecord.countDocuments().exec()).toBe(1)
    expect(record).toMatchObject({
      rank: 3,
      teitokuLv: 120,
      origin: reporterOrigin,
    })
  })

  test('returns known quests in current lexicographic sort order and accepts the legacy quest no-op route', async () => {
    await Quest.create([
      { questId: 2, title: 'B' },
      { questId: 10, title: 'C' },
      { questId: 1, title: 'A' },
    ])

    const knownQuestsResponse = await request('GET', '/api/report/v2/known_quests')
    const questNoopResponse = await postReport('/api/report/v2/quest/1', { ignored: true })

    expect(knownQuestsResponse.status).toBe(200)
    expect(knownQuestsResponse.body).toEqual({ quests: [1, 10, 2] })
    expect(questNoopResponse.status).toBe(200)
    expect(await Quest.countDocuments().exec()).toBe(3)
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

    expect(eligibleResponse.status).toBe(200)
    expect(ineligibleResponse.status).toBe(200)
    expect(await AACIRecord.countDocuments().exec()).toBe(1)
    expect(await AACIRecord.findOne().lean().exec()).toMatchObject({
      origin: 'Reporter 3.6.0',
      poiVersion: '7.9.2',
    })
  })

  test('returns legacy known recipes and deduplicates remodel recipes', async () => {
    const knownRecipesResponse = await request('GET', '/api/report/v2/known_recipes')
    await RecipeRecord.create([
      { key: 'duplicate', recipeId: 1, itemId: 1 },
      { key: 'duplicate', recipeId: 2, itemId: 2 },
    ])

    const dedupeResponse = await request('POST', '/api/report/v2/remodel_recipe_deduplicate', {})

    expect(knownRecipesResponse.status).toBe(200)
    expect(knownRecipesResponse.body).toEqual({ recipes: [] })
    expect(dedupeResponse.status).toBe(200)
    expect(dedupeResponse.body).toMatchObject({ recipes: expect.any(Array) })
    expect((dedupeResponse.body as { recipes: unknown[] }).recipes).toHaveLength(1)
    expect(await RecipeRecord.countDocuments({ key: 'duplicate' }).exec()).toBe(1)
  })

  test('upserts remodel recipes and ignores stage -1 reports', async () => {
    const payload = {
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

    const firstResponse = await postReport('/api/report/v2/remodel_recipe', payload)
    const secondResponse = await postReport('/api/report/v2/remodel_recipe', payload)
    const ignoredResponse = await postReport('/api/report/v2/remodel_recipe', {
      ...payload,
      recipeId: 34,
      stage: -1,
    })

    const record = await RecipeRecord.findOne({
      recipeId: 33,
      itemId: 700,
      stage: 1,
      day: 6,
      secretary: 100,
    })
      .lean()
      .exec()

    expect(firstResponse.status).toBe(200)
    expect(secondResponse.status).toBe(200)
    expect(ignoredResponse.status).toBe(200)
    expect(record).toMatchObject({ count: 2, origin: reporterOrigin })
    expect(await RecipeRecord.countDocuments().exec()).toBe(1)
  })

  test('accepts the legacy night battle ss ci no-op route', async () => {
    const response = await postReport('/api/report/v2/night_battle_ss_ci', { ignored: true })

    expect(response.status).toBe(200)
    expect(await NightBattleCI.countDocuments().exec()).toBe(0)
  })

  test('upserts ship stats and merges enemy info bomber ranges', async () => {
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

    const shipStatResponses = await Promise.all([
      postReport('/api/report/v2/ship_stat', shipStatPayload),
      postReport('/api/report/v2/ship_stat', shipStatPayload),
    ])
    const enemyInfoResponses = await Promise.all([
      postReport('/api/report/v2/enemy_info', enemyPayload),
      postReport('/api/report/v2/enemy_info', {
        ...enemyPayload,
        bombersMin: 7,
        bombersMax: 8,
      }),
    ])

    const shipStat = await ShipStat.findOne({ id: 100 }).lean().exec()
    const enemyInfo = await EnemyInfo.findOne({ ships1: [1, 2], planes: 10 })
      .lean()
      .exec()

    expect(shipStatResponses.map((response) => response.status)).toEqual([200, 200])
    expect(enemyInfoResponses.map((response) => response.status)).toEqual([200, 200])
    expect(shipStat).toMatchObject({ count: 2 })
    expect(enemyInfo).toMatchObject({
      bombersMin: 7,
      bombersMax: 8,
      count: 2,
    })
  })

  test('returns 400 for malformed and non-object report payloads', async () => {
    const malformedResponse = await postReport('/api/report/v2/create_ship', '{')
    const nonObjectResponse = await postReport('/api/report/v2/create_ship', 1)

    expect(malformedResponse.status).toBe(400)
    expect(malformedResponse.body).toEqual({ error: 'data must be valid JSON' })
    expect(nonObjectResponse.status).toBe(400)
    expect(nonObjectResponse.body).toEqual({ error: 'data must be a JSON object' })
    expect(await CreateShipRecord.countDocuments().exec()).toBe(0)
  })
})

describe('v3 report endpoints', () => {
  test('ingests item improvement facts and exports every fact type', async () => {
    const ingestResponse = await postReport('/api/report/v3/item_improvement_recipe', {
      records: itemImprovementRecords,
    })
    const availabilityResponse = await request(
      'GET',
      '/api/report/v3/item_improvement_recipes/availability?updatedAfter=0&limit=5000',
    )
    const costsResponse = await request('GET', '/api/report/v3/item_improvement_recipes/costs')
    const updatesResponse = await request('GET', '/api/report/v3/item_improvement_recipes/updates')

    expect(ingestResponse.status).toBe(200)
    expect(ingestResponse.body).toEqual({ records: 3 })
    expect(await ItemImprovementRecipeAvailabilityFact.countDocuments().exec()).toBe(1)
    expect(await ItemImprovementRecipeCostFact.countDocuments().exec()).toBe(1)
    expect(await ItemImprovementRecipeUpdateFact.countDocuments().exec()).toBe(1)
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
    expect(updatesResponse.status).toBe(200)
    expect(updatesResponse.body).toMatchObject({
      records: [
        {
          key: 'v1|update|33|700|10|6|102|701|0',
        },
      ],
    })
  })

  test('exports item improvement facts after a cursor', async () => {
    await postReport('/api/report/v3/item_improvement_recipe', {
      records: itemImprovementRecords,
    })
    const firstPage = await request(
      'GET',
      '/api/report/v3/item_improvement_recipes/availability?updatedAfter=0&limit=1',
    )
    const next = (firstPage.body as { next: { updatedAfter: number; afterId: string } }).next

    const secondPage = await request(
      'GET',
      `/api/report/v3/item_improvement_recipes/availability?updatedAfter=${next.updatedAfter}&afterId=${next.afterId}`,
    )

    expect(firstPage.status).toBe(200)
    expect(secondPage.status).toBe(200)
    expect(secondPage.body).toEqual({ records: [], next: null })
  })

  test('returns 400 for invalid item improvement payloads and cursors', async () => {
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
  })

  test('upserts quests, exposes known quest prefixes, and stores quest rewards', async () => {
    const questResponse = await postReport(
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

    const quest = await Quest.findOne({ questId: 801 }).lean().exec()
    const reward = await QuestReward.findOne({ questId: 901 }).lean().exec()

    expect(questResponse.status).toBe(200)
    expect(quest).toMatchObject({
      key: '8b6799d18daec4c67b34b883f9cfc2d0',
      origin: reporterOrigin,
    })
    expect(knownQuestsResponse.status).toBe(200)
    expect(knownQuestsResponse.body).toEqual({ quests: ['8b6799d1'] })
    expect(rewardResponse.status).toBe(200)
    expect(reward).toMatchObject({
      key: '12bd88872bd8320b5900b36276e8050e',
      origin: reporterOrigin,
      selections: [1],
      bounsCount: 1,
    })
  })

  test('returns 400 for malformed and missing v3 report payloads', async () => {
    const malformedResponse = await postReport('/api/report/v3/quest', '{')
    const missingResponse = await request('POST', '/api/report/v3/quest', {}, getReportHeaders())

    expect(malformedResponse.status).toBe(400)
    expect(malformedResponse.body).toEqual({ error: 'data must be valid JSON' })
    expect(missingResponse.status).toBe(400)
    expect(missingResponse.body).toEqual({ error: 'data must be a JSON object' })
    expect(await Quest.countDocuments().exec()).toBe(0)
  })
})
