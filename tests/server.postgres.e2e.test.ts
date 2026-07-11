import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

// PostgreSQL production-path e2e suite (docs/postgresql-migration-plan.md lines 907-992).
//
// This suite requires a real PostgreSQL 18 service; it never falls back to PGlite or any other
// embedded/in-memory PostgreSQL implementation. Point it at a disposable local database whose
// name contains "poi-e2e" through POI_SERVER_POSTGRES_E2E_URL:
//
//   POI_SERVER_POSTGRES_E2E_URL=postgres://postgres:postgres@localhost:5432/poi-e2e
//
// Before running this file, the target database must already have the Drizzle migrations and
// exactly one Data Epoch applied through the explicit CI/local commands (never automatically by
// the application):
//
//   POI_SERVER_DATABASE_URL=$POI_SERVER_POSTGRES_E2E_URL npm run db:migrate
//   POI_SERVER_DATABASE_URL=$POI_SERVER_POSTGRES_E2E_URL npm run db:create-epoch -- 2024-01-01T00:00:00.000Z
//
// When POI_SERVER_POSTGRES_E2E_URL is unset, this suite skips cleanly (see describe.skipIf below).
// In CI, the variable is always set, so the suite always runs there.

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

import { type AddressInfo } from 'net'
import { Pool } from 'pg'

import { estimatedCountsSchema, type DataEpoch } from '../src/contracts/database'
import {
  createUpcomingMonthPartitions,
  type CreateUpcomingMonthPartitionOutcome,
} from '../src/db/postgres/partitions/create-upcoming-month'
import {
  inspectPartitionCatalog,
  assertExactMonthlyPartitionBounds,
} from '../src/db/postgres/partitions/catalog'
import {
  computeDumpMonthBoundsUtc,
  deriveDefaultPartitionName,
  deriveMonthlyPartitionName,
  derivePendingPartitionName,
  parseDumpMonth,
} from '../src/db/postgres/partitions/dump-month'
import {
  PartitionCatalogMismatchError,
  PartitionMaintenanceError,
} from '../src/db/postgres/partitions/errors'
import { observationParentTables } from '../src/db/postgres/partitions/observation-tables'
import { repairMonthlyPartition } from '../src/db/postgres/partitions/repair-monthly-partition'
import { startServer } from '../src/server'
import { createPostgresPool } from '../src/db/postgres/client'

const postgresE2eUrl = process.env.POI_SERVER_POSTGRES_E2E_URL ?? ''
const isRunningInCi = process.env.CI === 'true' || process.env.CI === '1'
const hasPostgresE2eUrl = postgresE2eUrl !== ''

// A CI run that forgot to set the opt-in variable must fail loudly rather than silently skip the
// entire production-path parity suite.
if (!hasPostgresE2eUrl && isRunningInCi) {
  throw new Error(
    'POI_SERVER_POSTGRES_E2E_URL must be set when running in CI; the PostgreSQL e2e suite must not silently skip.',
  )
}

const ESTIMATED_COUNT_KEYS = Object.keys(estimatedCountsSchema.shape).sort()

const E2E_TABLES = [
  'create_ship_records',
  'create_item_records',
  'remodel_item_records',
  'drop_ship_records',
  'pass_event_records',
  'battle_apis',
  'night_contacts',
  'aaci_records',
  'night_battle_cis',
  'select_rank_records',
  'recipe_records',
  'ship_stats',
  'enemy_infos',
  'quests',
  'quest_rewards',
  'item_improvement_availability_facts',
  'item_improvement_cost_facts',
  'item_improvement_update_facts',
] as const

const localPostgresHosts = new Set(['localhost', '127.0.0.1', '::1'])

// Mirrors server.e2e.test.ts's Mongo safety check: refuse to run against anything that is not an
// explicitly-named, local, disposable database.
const assertPostgresE2eUrl = (rawUrl: string): void => {
  const url = new URL(rawUrl)
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error(
      `POI_SERVER_POSTGRES_E2E_URL must use a postgres: or postgresql: scheme, got ${url.protocol}`,
    )
  }
  const databaseName = url.pathname.replace(/^\/+/, '').split('?')[0]
  if (!databaseName.includes('poi-e2e')) {
    throw new Error(
      `Refusing to run PostgreSQL e2e tests against non-e2e database: ${databaseName || '<none>'}`,
    )
  }
  if (!localPostgresHosts.has(url.hostname)) {
    throw new Error(
      `Refusing to run PostgreSQL e2e tests against non-local PostgreSQL host: ${url.hostname}`,
    )
  }
}

const reporterOrigin = 'Reporter/8.1.0 poi/10.3.99'
const observedAt = Date.UTC(2026, 6, 3, 15)

interface TestResponse {
  body: unknown
  headers: Headers
  status: number
  text: string
}

let baseUrl: string
let closeServer: (() => Promise<void>) | undefined
let verificationPool: Pool
let epoch: DataEpoch

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

const queryRows = async <T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> => {
  const result = await verificationPool.query<T>(text, values)
  return result.rows
}

const queryOne = async <T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  values: unknown[] = [],
): Promise<T> => {
  const rows = await queryRows<T>(text, values)
  if (rows.length !== 1) {
    throw new Error(`Expected exactly one row, found ${rows.length} for: ${text}`)
  }
  return rows[0]
}

// Selects only the given business columns (never "id"/"ingested_at") so the returned row can be
// compared directly against an expected-fields object without discarding surrogate key columns.
const fetchOnlyRow = async (
  table: string,
  columns: readonly string[],
): Promise<Record<string, unknown>> => {
  const columnList = columns.map((column) => `"${column}"`).join(', ')
  const rows = await queryRows(`select ${columnList} from "${table}"`)
  expect(rows).toHaveLength(1)
  return rows[0]
}

const expectColumnMissing = async (table: string, column: string): Promise<void> => {
  await expect(queryRows(`select "${column}" from "${table}"`)).rejects.toThrow(
    new RegExp(`column .*${column}.* does not exist`, 'i'),
  )
}

const truncateE2eTables = async (): Promise<void> => {
  await verificationPool.query(
    `truncate table ${E2E_TABLES.map((name) => `"${name}"`).join(', ')} restart identity`,
  )
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

describe.skipIf(!hasPostgresE2eUrl)('PostgreSQL production-path e2e', () => {
  beforeAll(async () => {
    assertPostgresE2eUrl(postgresE2eUrl)
    verificationPool = new Pool({ connectionString: postgresE2eUrl, max: 5 })

    const epochRows = await verificationPool.query<{ id: string; started_at: Date }>(
      'select id, started_at from data_epochs limit 1',
    )
    if (epochRows.rows.length !== 1) {
      throw new Error(
        'PostgreSQL e2e database has no Data Epoch. Run "npm run db:migrate" and ' +
          '"npm run db:create-epoch -- <timestamp>" against POI_SERVER_POSTGRES_E2E_URL before running this suite.',
      )
    }
    epoch = {
      id: epochRows.rows[0].id,
      startedAt: epochRows.rows[0].started_at.toISOString(),
    }

    const started = await startServer({
      db: postgresE2eUrl,
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
    await truncateE2eTables()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  afterAll(async () => {
    await closeServer?.()
    await verificationPool?.end()
  })

  describe('database status', () => {
    test('reports the backend-neutral shape with all 18 estimated counts and the created Data Epoch', async () => {
      await postReport('/api/report/v2/create_ship', createShipPayload)

      const response = await request('GET', '/api/status')

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({
        env: process.env.NODE_ENV,
        database: {
          backend: 'postgresql',
          status: 'up',
          epoch,
        },
      })
      expect(response.body).not.toHaveProperty('mongo')

      const database = (response.body as { database: { estimatedCounts: Record<string, number> } })
        .database
      expect(Object.keys(database.estimatedCounts).sort()).toEqual(ESTIMATED_COUNT_KEYS)
      for (const key of ESTIMATED_COUNT_KEYS) {
        expect(Number.isInteger(database.estimatedCounts[key])).toBe(true)
        expect(database.estimatedCounts[key]).toBeGreaterThanOrEqual(0)
      }
    })
  })

  describe('v2 observation report endpoints', () => {
    interface ObservationCase {
      path: string
      table: string
      payload: Record<string, unknown>
      expectedRow: Record<string, unknown>
      missingColumns?: string[]
    }

    test('persists declared fields and discards unknown input fields and non-schema origin injection', async () => {
      const cases: ObservationCase[] = [
        {
          path: '/api/report/v2/create_ship',
          table: 'create_ship_records',
          payload: { ...createShipPayload, unknownField: 'nope' },
          expectedRow: {
            items: [30, 30, 30, 30],
            kdock_id: 1,
            secretary: 100,
            ship_id: 101,
            highspeed: 0,
            teitoku_lv: 120,
            large_flag: false,
            origin: reporterOrigin,
          },
        },
        {
          path: '/api/report/v2/create_item',
          table: 'create_item_records',
          payload: {
            items: [10, 20, 30, 40],
            secretary: 100,
            itemId: 15,
            teitokuLv: 120,
            successful: true,
            unknownField: 'nope',
          },
          expectedRow: {
            items: [10, 20, 30, 40],
            secretary: 100,
            item_id: 15,
            teitoku_lv: 120,
            successful: true,
            origin: reporterOrigin,
          },
        },
        {
          path: '/api/report/v2/remodel_item',
          table: 'remodel_item_records',
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
            origin: 'malicious-origin',
            unknownField: 'nope',
          },
          expectedRow: {
            successful: true,
            item_id: 200,
            item_level: 6,
            flagship_id: 100,
            flagship_level: 90,
            flagship_cond: 49,
            consort_id: 101,
            consort_level: 80,
            consort_cond: 50,
            teitoku_lv: 120,
            certain: false,
          },
          missingColumns: ['origin'],
        },
        {
          path: '/api/report/v2/pass_event',
          table: 'pass_event_records',
          payload: {
            teitokuId: 'admiral-1',
            teitokuLv: 120,
            mapId: 502,
            mapLv: 3,
            rewards: [{ rewardType: 1, rewardId: 2, rewardCount: 3, rewardLevel: 0 }],
            unknownField: 'nope',
          },
          expectedRow: {
            teitoku_id: 'admiral-1',
            teitoku_lv: 120,
            map_id: 502,
            map_lv: 3,
            rewards: [{ rewardType: 1, rewardId: 2, rewardCount: 3, rewardLevel: 0 }],
            origin: reporterOrigin,
          },
        },
        {
          path: '/api/report/v2/battle_api',
          table: 'battle_apis',
          payload: {
            path: '/kcsapi/api_req_sortie/battle',
            data: { api_result: 1, nested: { array: [1, 2, 3] } },
            unknownField: 'nope',
          },
          expectedRow: {
            path: '/kcsapi/api_req_sortie/battle',
            data: { api_result: 1, nested: { array: [1, 2, 3] } },
            origin: reporterOrigin,
          },
        },
        {
          path: '/api/report/v2/night_contcat',
          table: 'night_contacts',
          payload: {
            fleetType: 1,
            shipId: 100,
            shipLv: 90,
            itemId: 102,
            itemLv: 3,
            contact: true,
            origin: 'malicious-origin',
            unknownField: 'nope',
          },
          expectedRow: {
            fleet_type: 1,
            ship_id: 100,
            ship_lv: 90,
            item_id: 102,
            item_lv: 3,
            contact: true,
          },
          missingColumns: ['origin'],
        },
      ]

      for (const testCase of cases) {
        const response = await postReport(testCase.path, testCase.payload)
        expect(response.status).toBe(200)

        const row = await fetchOnlyRow(testCase.table, Object.keys(testCase.expectedRow))
        expect(row).toEqual(testCase.expectedRow)

        for (const column of testCase.missingColumns ?? []) {
          await expectColumnMissing(testCase.table, column)
        }
      }
    })

    test('defaults an omitted array field to an empty array', async () => {
      const response = await postReport('/api/report/v2/create_ship', {
        kdockId: 1,
        secretary: 100,
        shipId: 555,
        highspeed: 0,
        teitokuLv: 120,
        largeFlag: true,
      })

      expect(response.status).toBe(200)
      const row = await queryOne<{ items: number[] }>(
        'select items from create_ship_records where ship_id = 555',
      )
      expect(row.items).toEqual([])
    })

    test('normalizes drop ship snapshots to {} below map 73 and for explicit-null mapId', async () => {
      const buildPayload = (shipId: number, mapId: number | null, cellId: number) => ({
        shipId,
        itemId: 0,
        mapId,
        quest: 'A',
        cellId,
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

      const early = await postReport('/api/report/v2/drop_ship', buildPayload(1, 72, 1))
      const late = await postReport('/api/report/v2/drop_ship', buildPayload(2, 73, 2))
      const nullMap = await postReport('/api/report/v2/drop_ship', buildPayload(3, null, 3))

      expect([early, late, nullMap].map((r) => r.status)).toEqual([200, 200, 200])

      const rows = await queryRows<{ ship_id: number; owned_ship_snapshot: unknown }>(
        'select ship_id, owned_ship_snapshot from drop_ship_records order by ship_id',
      )
      expect(rows).toEqual([
        { ship_id: 1, owned_ship_snapshot: {} },
        { ship_id: 2, owned_ship_snapshot: { '1': [100] } },
        { ship_id: 3, owned_ship_snapshot: {} },
      ])
    })

    test('gates AACI persistence by poi and reporter versions and only writes when eligible', async () => {
      const eligiblePayload = {
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
      }

      const eligible = await postReport('/api/report/v2/aaci', eligiblePayload, {
        'x-reporter': 'Reporter 3.6.0',
      })
      const ineligible = await postReport(
        '/api/report/v2/aaci',
        { ...eligiblePayload, poiVersion: '7.9.1' },
        { 'x-reporter': 'Reporter 3.6.0' },
      )

      expect(eligible.status).toBe(200)
      expect(ineligible.status).toBe(200)

      const rows = await queryRows<{ poi_version: string; origin: string }>(
        'select poi_version, origin from aaci_records',
      )
      expect(rows).toEqual([{ poi_version: '7.9.2', origin: 'Reporter 3.6.0' }])
    })

    test('persists fractional night battle damage/damageTotal and round-trips the BIGINT time column without precision loss', async () => {
      const payload = {
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
        damage: [12.5, 7.25],
        damageTotal: 19.75,
        time: observedAt,
      }

      const response = await postReport('/api/report/v2/night_battle_ci', payload)

      expect(response.status).toBe(200)
      const row = await queryOne<{ damage: number[]; damage_total: number; time: string }>(
        'select damage, damage_total, time from night_battle_cis',
      )
      expect(row.damage).toEqual([12.5, 7.25])
      expect(row.damage_total).toBeCloseTo(19.75)
      // node-postgres parses bigint (int8) columns as strings by default; production code must
      // explicitly Number()-cast them (see the v3 export JSON-number assertions below).
      expect(typeof row.time).toBe('string')
      expect(Number(row.time)).toBe(observedAt)
    })
  })

  describe('v2 current-state, aggregate, and no-op endpoints', () => {
    test('upserts select_rank records by admiral and map area without creating a second row', async () => {
      const first = await postReport('/api/report/v2/select_rank', {
        teitokuId: 'admiral-1',
        teitokuLv: 100,
        mapareaId: 5,
        rank: 1,
      })
      const second = await postReport('/api/report/v2/select_rank', {
        teitokuId: 'admiral-1',
        teitokuLv: 120,
        mapareaId: 5,
        rank: 3,
      })

      expect(first.status).toBe(200)
      expect(second.status).toBe(200)

      const rows = await queryRows<{ teitoku_lv: number; rank: number; origin: string }>(
        'select teitoku_lv, rank, origin from select_rank_records where teitoku_id = $1 and maparea_id = 5',
        ['admiral-1'],
      )
      expect(rows).toEqual([{ teitoku_lv: 120, rank: 3, origin: reporterOrigin }])
    })

    test('upserts remodel_recipe aggregates using database time, increments count, and ignores stage -1 reports', async () => {
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

      const first = await postReport('/api/report/v2/remodel_recipe', payload)
      const second = await postReport('/api/report/v2/remodel_recipe', payload)
      const ignored = await postReport('/api/report/v2/remodel_recipe', {
        ...payload,
        recipeId: 34,
        stage: -1,
      })

      expect(first.status).toBe(200)
      expect(second.status).toBe(200)
      expect(ignored.status).toBe(200)

      const rows = await queryRows<{ count: string; last_reported: string }>(
        'select count, last_reported from recipe_records',
      )
      expect(rows).toHaveLength(1)
      expect(Number(rows[0].count)).toBe(2)

      // last_reported must come from PostgreSQL's own clock, not the mocked application
      // Date.now(); it should land near real wall-clock time, not the fixed mocked observedAt.
      const nowRow = await queryOne<{ now: string }>(
        'select (extract(epoch from clock_timestamp()) * 1000)::bigint as now',
      )
      expect(Math.abs(Number(rows[0].last_reported) - Number(nowRow.now))).toBeLessThan(60000)
      expect(Number(rows[0].last_reported)).not.toBe(observedAt)
    })

    test('returns an empty recipes array for known_recipes and remodel_recipe_deduplicate because Domain Identity is unique', async () => {
      await verificationPool.query(
        `insert into recipe_records (recipe_id, item_id, stage, day, secretary, last_reported)
         values (1, 1, 1, 1, 1, 0)`,
      )

      const knownRecipes = await request('GET', '/api/report/v2/known_recipes')
      const dedupe = await request('POST', '/api/report/v2/remodel_recipe_deduplicate', {})

      expect(knownRecipes.status).toBe(200)
      expect(knownRecipes.body).toEqual({ recipes: [] })
      expect(dedupe.status).toBe(200)
      expect(dedupe.body).toEqual({ recipes: [] })
      const rows = await queryRows('select 1 from recipe_records')
      expect(rows).toHaveLength(1)
    })

    test('accepts the legacy night_battle_ss_ci and quest/:id no-op routes without writing', async () => {
      const nightBattleSsCi = await postReport('/api/report/v2/night_battle_ss_ci', {
        ignored: true,
      })
      const questNoop = await postReport('/api/report/v2/quest/1', { ignored: true })

      expect(nightBattleSsCi.status).toBe(200)
      expect(questNoop.status).toBe(200)
      expect(await queryRows('select 1 from night_battle_cis')).toHaveLength(0)
      expect(await queryRows('select 1 from quests')).toHaveLength(0)
    })

    test('upserts ship_stat aggregates and increments count using database-generated timestamps', async () => {
      const payload = {
        id: 100,
        lv: 99,
        los: 80,
        los_max: 90,
        asw: 70,
        asw_max: 80,
        evasion: 100,
        evasion_max: 110,
      }

      const responses = await Promise.all([
        postReport('/api/report/v2/ship_stat', payload),
        postReport('/api/report/v2/ship_stat', payload),
      ])

      expect(responses.map((response) => response.status)).toEqual([200, 200])
      const row = await queryOne<{ count: string }>(
        'select count from ship_stats where ship_id = 100',
      )
      expect(Number(row.count)).toBe(2)
    })

    test('merges enemy_info bomber ranges across absent, numeric, and explicit-null transitions', async () => {
      const basePayload = {
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
      }

      const absent = await postReport('/api/report/v2/enemy_info', basePayload)
      const numeric = await postReport('/api/report/v2/enemy_info', {
        ...basePayload,
        bombersMin: 5,
        bombersMax: 10,
      })
      const explicitNull = await postReport('/api/report/v2/enemy_info', {
        ...basePayload,
        bombersMax: null,
      })

      expect([absent, numeric, explicitNull].map((response) => response.status)).toEqual([
        200, 200, 200,
      ])

      const row = await queryOne<{
        bombers_min: number | null
        bombers_max: number | null
        count: string
      }>('select bombers_min, bombers_max, count from enemy_infos')
      expect(row.bombers_min).toBe(5)
      expect(row.bombers_max).toBeNull()
      expect(Number(row.count)).toBe(3)
    })

    test('returns known quests in current JavaScript default sort order', async () => {
      const keyFor = (suffix: string) => suffix.padStart(32, '0')
      await verificationPool.query(
        `insert into quests (key, quest_id, title, detail, category) values
           ($1, 2, 'B', 'b', 1),
           ($2, 10, 'C', 'c', 1),
           ($3, 1, 'A', 'a', 1)`,
        [keyFor('1'), keyFor('2'), keyFor('3')],
      )

      const response = await request('GET', '/api/report/v2/known_quests')

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ quests: [1, 10, 2] })
      expect(response.headers.get('cache-control')).toContain('max-age=60')
    })
  })

  describe('shared validation', () => {
    test('returns 400 for malformed JSON and non-object payloads without writing', async () => {
      const malformed = await postReport('/api/report/v2/create_ship', '{')
      const nonObject = await postReport('/api/report/v2/create_ship', 1)

      expect(malformed.status).toBe(400)
      expect(malformed.body).toEqual({ error: 'data must be valid JSON' })
      expect(nonObject.status).toBe(400)
      expect(nonObject.body).toEqual({ error: 'data must be a JSON object' })
      expect(await queryRows('select 1 from create_ship_records')).toHaveLength(0)
    })

    test('applies shared casting, 32-bit integer bounds, Domain Identity requirements, and AACI semver validation', async () => {
      const cast = await postReport('/api/report/v2/create_item', {
        items: '7',
        itemId: '8',
        successful: 'yes',
      })
      const fractional = await postReport('/api/report/v2/create_item', { itemId: 1.5 })
      const outOfRange = await postReport('/api/report/v2/create_item', {
        items: [2147483648],
      })
      const missingIdentity = await postReport('/api/report/v2/select_rank', { teitokuLv: 120 })
      const invalidPoiVersion = await postReport('/api/report/v2/aaci', {
        poiVersion: 'not-semver',
      })
      const invalidReporterVersion = await postReport(
        '/api/report/v2/aaci',
        { poiVersion: '8.0.0' },
        { 'x-reporter': 'Reporter not-semver' },
      )

      expect(cast.status).toBe(200)
      const row = await queryOne<{ items: number[]; item_id: number; successful: boolean }>(
        'select items, item_id, successful from create_item_records',
      )
      expect(row).toEqual({ items: [7], item_id: 8, successful: true })
      expect(fractional).toMatchObject({
        status: 400,
        body: { error: 'itemId: expected signed 32-bit integer' },
      })
      expect(outOfRange).toMatchObject({
        status: 400,
        body: { error: 'items.0: expected signed 32-bit integer' },
      })
      expect(missingIdentity.status).toBe(400)
      expect(invalidPoiVersion.status).toBe(400)
      expect(invalidReporterVersion.status).toBe(400)

      const itemCount = await queryOne<{ count: string }>(
        'select count(*) from create_item_records',
      )
      expect(Number(itemCount.count)).toBe(1)
      const aaciCount = await queryOne<{ count: string }>('select count(*) from aaci_records')
      expect(Number(aaciCount.count)).toBe(0)
    })
  })

  describe('v3 quests and rewards', () => {
    test('upserts quests by MD5 title/detail key, exposes known 8-character prefixes, and is insert-only for repeats', async () => {
      const questPayload = {
        quests: [
          { questId: 801, category: 2, type: 1, title: 'Test quest', detail: 'Test details' },
        ],
      }

      const first = await postReport('/api/report/v3/quest', questPayload)
      const second = await postReport('/api/report/v3/quest', questPayload)
      const knownQuestsResponse = await request('GET', '/api/report/v3/known_quests')

      expect(first.status).toBe(200)
      expect(second.status).toBe(200)

      const row = await queryOne<{ key: string; origin: string }>(
        'select key, origin from quests where quest_id = 801',
      )
      expect(row).toEqual({ key: '8b6799d18daec4c67b34b883f9cfc2d0', origin: reporterOrigin })
      const countRow = await queryOne<{ count: string }>(
        'select count(*) from quests where quest_id = 801',
      )
      expect(Number(countRow.count)).toBe(1)
      expect(knownQuestsResponse.status).toBe(200)
      expect(knownQuestsResponse.body).toEqual({ quests: ['8b6799d1'] })
    })

    test('stores quest rewards including the legacy bounsCount field', async () => {
      const response = await postReport('/api/report/v3/quest_reward', {
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

      expect(response.status).toBe(200)
      const row = await queryOne<{
        key: string
        origin: string
        selections: number[]
        bonus_count: number
      }>('select key, origin, selections, bonus_count from quest_rewards where quest_id = 901')
      expect(row).toEqual({
        key: '12bd88872bd8320b5900b36276e8050e',
        origin: reporterOrigin,
        selections: [1],
        bonus_count: 1,
      })
    })

    test('returns 400 for malformed and missing v3 payloads without writing', async () => {
      const malformed = await postReport('/api/report/v3/quest', '{')
      const missing = await request('POST', '/api/report/v3/quest', {}, getReportHeaders())
      const missingQuestIdentity = await postReport('/api/report/v3/quest', {
        quests: [{ questId: 1, category: 2, detail: 'detail without a title' }],
      })
      const missingRewardIdentity = await postReport('/api/report/v3/quest_reward', {
        questId: 1,
        title: 'title',
        detail: 'detail',
        selections: [1],
      })

      expect(malformed.status).toBe(400)
      expect(malformed.body).toEqual({ error: 'data must be valid JSON' })
      expect(missing.status).toBe(400)
      expect(missing.body).toEqual({ error: 'data must be a JSON object' })
      expect(missingQuestIdentity.status).toBe(400)
      expect(missingRewardIdentity.status).toBe(400)
      expect(await queryRows('select 1 from quests')).toHaveLength(0)
    })
  })

  describe('v3 item-improvement ingestion and export', () => {
    test('ingests one record of each source kind in a single batch and persists their declared fields', async () => {
      const response = await postReport('/api/report/v3/item_improvement_recipe', {
        records: itemImprovementRecords,
      })

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ records: 3 })

      const availability = await queryOne<{ key: string; sources: string[]; count: string }>(
        'select key, sources, count from item_improvement_availability_facts',
      )
      expect(availability.key).toBe('v1|availability|33|700|6|0')
      expect(availability.sources).toEqual(['list'])
      expect(Number(availability.count)).toBe(1)

      const cost = await queryOne<{
        key: string
        req_slot_items: unknown
        req_use_items: unknown
      }>('select key, req_slot_items, req_use_items from item_improvement_cost_facts')
      expect(cost.key).toBe('v1|cost|33|700|6|1|6|0|10|20|30|40|3|4|5|6|90:2|65:1|0')
      expect(cost.req_slot_items).toEqual([{ id: 90, count: 2 }])
      expect(cost.req_use_items).toEqual([{ id: 65, count: 1 }])

      const update = await queryOne<{ key: string; upgrade_observed: boolean }>(
        'select key, upgrade_observed from item_improvement_update_facts',
      )
      expect(update.key).toBe('v1|update|33|700|10|6|102|701|0')
      expect(update.upgrade_observed).toBe(true)
    })

    test('accumulates stable arrays, min/max client-observed timestamps, distinct origins, and counts for repeated availability reports', async () => {
      const baseRecord = {
        schemaVersion: 1,
        source: 'list',
        recipeId: 5001,
        itemId: 5001700,
        day: 6,
        observedSecondShipId: 0,
      }

      const first = await postReport(
        '/api/report/v3/item_improvement_recipe',
        { ...baseRecord, clientObservedAt: observedAt, observedFlagshipId: 201 },
        { 'x-reporter': 'Reporter A' },
      )
      const second = await postReport(
        '/api/report/v3/item_improvement_recipe',
        { ...baseRecord, clientObservedAt: observedAt + 2000, observedFlagshipId: 202 },
        { 'x-reporter': 'Reporter B' },
      )
      const third = await postReport(
        '/api/report/v3/item_improvement_recipe',
        { ...baseRecord, clientObservedAt: observedAt + 1000, observedFlagshipId: 201 },
        { 'x-reporter': 'Reporter A' },
      )

      expect([first, second, third].map((response) => response.status)).toEqual([200, 200, 200])

      const row = await queryOne<{
        first_client_observed_at: string
        last_client_observed_at: string
        observed_flagship_ids: number[]
        sources: string[]
        origins: string[]
        count: string
      }>(
        'select first_client_observed_at, last_client_observed_at, observed_flagship_ids, sources, origins, count from item_improvement_availability_facts',
      )

      expect(Number(row.first_client_observed_at)).toBe(observedAt)
      expect(Number(row.last_client_observed_at)).toBe(observedAt + 2000)
      expect(row.observed_flagship_ids).toEqual([201, 202])
      expect(row.sources).toEqual(['list'])
      expect(row.origins).toEqual(['Reporter A', 'Reporter B'])
      expect(Number(row.count)).toBe(3)
    })

    test('returns 400 for invalid records, oversized batches, out-of-range values, and invalid cursors without writing', async () => {
      const malformed = await postReport('/api/report/v3/item_improvement_recipe', '{')
      const invalidRecord = await postReport('/api/report/v3/item_improvement_recipe', {
        ...itemImprovementRecords[1],
        reqUseItems: [{ id: 65, count: 0 }],
      })
      const oversizedBatch = await postReport('/api/report/v3/item_improvement_recipe', {
        records: Array.from({ length: 101 }, () => itemImprovementRecords[0]),
      })
      const outOfRangeRecord = await postReport('/api/report/v3/item_improvement_recipe', {
        ...itemImprovementRecords[0],
        recipeId: 2147483648,
      })
      const invalidCursor = await request(
        'GET',
        '/api/report/v3/item_improvement_recipes/availability?afterId=invalid-object-id',
      )
      const unsafeTimestampCursor = await request(
        'GET',
        '/api/report/v3/item_improvement_recipes/availability?updatedAfter=9007199254740992',
      )

      expect(malformed.status).toBe(400)
      expect(malformed.body).toEqual({ error: 'data must be valid JSON' })
      expect(invalidRecord.status).toBe(400)
      expect(invalidRecord.body).toEqual({
        error: 'reqUseItems.0: must contain positive id and count',
      })
      expect(oversizedBatch.status).toBe(400)
      expect(oversizedBatch.body).toEqual({
        error: 'records: Too big: expected array to have <=100 items',
      })
      expect(outOfRangeRecord.status).toBe(400)
      expect(invalidCursor.status).toBe(400)
      expect(invalidCursor.body).toEqual({ error: 'afterId: must be a valid ObjectId' })
      expect(unsafeTimestampCursor.status).toBe(400)

      expect(await queryRows('select 1 from item_improvement_availability_facts')).toHaveLength(0)
    })

    const settledWindowCases = [
      {
        kind: 'availability',
        table: 'item_improvement_availability_facts',
        exportPath: '/api/report/v3/item_improvement_recipes/availability',
        record: {
          schemaVersion: 1,
          source: 'list',
          clientObservedAt: observedAt,
          recipeId: 6001,
          itemId: 6001700,
          day: 6,
          observedSecondShipId: 0,
          observedFlagshipId: 301,
        },
      },
      {
        kind: 'cost',
        table: 'item_improvement_cost_facts',
        exportPath: '/api/report/v3/item_improvement_recipes/costs',
        record: {
          schemaVersion: 1,
          source: 'detail',
          clientObservedAt: observedAt,
          recipeId: 6002,
          itemId: 6002700,
          itemLevel: 1,
          stage: 1,
          day: 6,
          observedSecondShipId: 0,
          observedFlagshipId: 301,
          fuel: 1,
          ammo: 1,
          steel: 1,
          bauxite: 1,
          buildkit: 0,
          remodelkit: 0,
          certainBuildkit: 0,
          certainRemodelkit: 0,
          reqSlotItems: [],
          reqUseItems: [],
          changeFlag: 0,
        },
      },
      {
        kind: 'update',
        table: 'item_improvement_update_facts',
        exportPath: '/api/report/v3/item_improvement_recipes/updates',
        record: {
          schemaVersion: 1,
          source: 'execution',
          clientObservedAt: observedAt,
          recipeId: 6003,
          itemId: 6003700,
          itemLevel: 1,
          day: 6,
          observedSecondShipId: 302,
          observedFlagshipId: 301,
          upgradeObserved: true,
          upgradeToItemId: 6003701,
          upgradeToItemLevel: 0,
        },
      },
    ] as const

    describe.each(settledWindowCases)(
      '$kind item-improvement export settled window',
      ({ table, exportPath, record }) => {
        test('excludes a fresh fact from export until manually aged past 30 seconds, then includes it with epoch/id set and origins omitted', async () => {
          const ingest = await postReport('/api/report/v3/item_improvement_recipe', record)
          expect(ingest.status).toBe(200)

          const fresh = await request('GET', `${exportPath}?updatedAfter=0`)
          expect(fresh.status).toBe(200)
          expect(fresh.body).toEqual({ epoch, records: [], next: null })

          // Manually age the fact past the 30-second settled window instead of sleeping.
          await verificationPool.query(
            `update "${table}" set last_reported = last_reported - 40000`,
          )

          const settled = await request('GET', `${exportPath}?updatedAfter=0`)
          expect(settled.status).toBe(200)
          const body = settled.body as {
            epoch: DataEpoch
            records: Array<Record<string, unknown>>
            next: { updatedAfter: number; afterId: string } | null
          }
          expect(body.epoch).toEqual(epoch)
          expect(body.records).toHaveLength(1)
          expect(body.records[0]).not.toHaveProperty('origins')
          expect(body.records[0]._id).toMatch(/^[0-9a-f]{24}$/)
          expect(typeof body.records[0].firstReported).toBe('number')
          expect(typeof body.records[0].lastReported).toBe('number')
          expect(body.next).toEqual({
            updatedAfter: body.records[0].lastReported,
            afterId: body.records[0]._id,
          })
        })
      },
    )

    test('paginates settled availability exports across limit and cursor boundaries, including an empty final page', async () => {
      const records = [
        {
          schemaVersion: 1,
          source: 'list',
          clientObservedAt: observedAt,
          recipeId: 7001,
          itemId: 7001700,
          day: 6,
          observedSecondShipId: 0,
          observedFlagshipId: 401,
        },
        {
          schemaVersion: 1,
          source: 'list',
          clientObservedAt: observedAt,
          recipeId: 7002,
          itemId: 7002700,
          day: 6,
          observedSecondShipId: 0,
          observedFlagshipId: 401,
        },
        {
          schemaVersion: 1,
          source: 'list',
          clientObservedAt: observedAt,
          recipeId: 7003,
          itemId: 7003700,
          day: 6,
          observedSecondShipId: 0,
          observedFlagshipId: 401,
        },
      ]

      const ingest = await postReport('/api/report/v3/item_improvement_recipe', { records })
      expect(ingest.status).toBe(200)
      expect(ingest.body).toEqual({ records: 3 })

      await verificationPool.query(
        `with timestamp_value as materialized (
           select (extract(epoch from clock_timestamp() - interval '40 seconds') * 1000)::bigint as value
         )
         update item_improvement_availability_facts
         set last_reported = timestamp_value.value
         from timestamp_value`,
      )
      const timestampCount = await queryOne<{ count: string }>(
        'select count(distinct last_reported) from item_improvement_availability_facts',
      )
      expect(Number(timestampCount.count)).toBe(1)

      const expectedOrder = await queryRows<{ export_id: string }>(
        'select export_id from item_improvement_availability_facts order by last_reported asc, export_id asc',
      )
      expect(expectedOrder).toHaveLength(3)

      const seenIds: string[] = []
      let updatedAfter = 0
      let afterId: string | undefined

      for (const expectedCount of [2, 1, 0]) {
        const query = new URLSearchParams({ updatedAfter: String(updatedAfter), limit: '2' })
        if (afterId != null) {
          query.set('afterId', afterId)
        }
        const page = await request(
          'GET',
          `/api/report/v3/item_improvement_recipes/availability?${query.toString()}`,
        )

        expect(page.status).toBe(200)
        const body = page.body as {
          records: Array<{ _id: string }>
          next: { updatedAfter: number; afterId: string } | null
        }
        expect(body.records).toHaveLength(expectedCount)
        seenIds.push(...body.records.map((record) => record._id))

        if (body.next == null) {
          expect(expectedCount).toBe(0)
          break
        }
        updatedAfter = body.next.updatedAfter
        afterId = body.next.afterId
      }

      expect(seenIds).toEqual(expectedOrder.map((row) => row.export_id))
    })
  })

  describe('connection and startup', () => {
    test('configures and enforces the PostgreSQL 10-second transaction bound', async () => {
      const pool = createPostgresPool(postgresE2eUrl, 1)
      const client = await pool.connect()
      try {
        const settings = await client.query<{
          statement_timeout: string
          transaction_timeout: string
        }>(
          "select current_setting('statement_timeout') as statement_timeout, current_setting('transaction_timeout') as transaction_timeout",
        )
        expect(settings.rows[0]).toEqual({
          statement_timeout: '10s',
          transaction_timeout: '10s',
        })

        await client.query('set statement_timeout = 0')
        await client.query("set transaction_timeout = '100ms'")
        await client.query('begin')
        await expect(client.query('select pg_sleep(0.5)')).rejects.toMatchObject({
          message: expect.stringMatching(/transaction timeout/i),
        })
      } finally {
        client.release(true)
        await pool.end()
      }
    })

    test('rejects startup with a redacted error when the PostgreSQL connection is refused', async () => {
      const badUrl = new URL(postgresE2eUrl)
      badUrl.port = '1'

      await expect(
        startServer({
          db: badUrl.toString(),
          disableLogger: true,
          host: '127.0.0.1',
          loadLatestCommit: false,
          port: 0,
        }),
      ).rejects.toThrow(/Unable to initialize PostgreSQL database/)
    }, 15000)

    test('starts and cleanly shuts down an independent PostgreSQL-backed HTTP server', async () => {
      const started = await startServer({
        db: postgresE2eUrl,
        disableLogger: true,
        host: '127.0.0.1',
        loadLatestCommit: false,
        port: 0,
      })
      const address = started.server.address() as AddressInfo
      const ephemeralBaseUrl = `http://127.0.0.1:${address.port}`

      const response = await fetch(`${ephemeralBaseUrl}/api/status`, {
        headers: { accept: 'application/json' },
      })
      expect(response.status).toBe(200)

      await started.close()

      await expect(fetch(`${ephemeralBaseUrl}/api/status`)).rejects.toThrow()
    })
  })

  // Community Dump monthly partition maintenance/repair seam
  // (docs/postgresql-migration-plan.md lines 713-739). These tests exercise the real
  // create-upcoming-month and repair commands against a real PostgreSQL 18 catalog, using
  // `verificationPool` directly as the `PartitionPool` (a real `pg.Pool` satisfies that
  // interface structurally, with no adapter/cast needed). Every Dump Month used here is far in
  // the future so it can never collide with a real Data Epoch or with any other test in this
  // file, and every partition/pending table this suite creates is dropped before and after each
  // test so the suite is safe to rerun any number of times against a persistent e2e database.
  describe('Community Dump monthly partition maintenance/repair', () => {
    const cleanDumpMonth = '2099-01'
    const repairDumpMonth = '2099-02'
    const mismatchDumpMonth = '2099-03'
    const mismatchTable = 'drop_ship_records'

    const dropPartitionArtifacts = async (table: string, dumpMonth: string): Promise<void> => {
      const parts = parseDumpMonth(dumpMonth)
      const partitionName = deriveMonthlyPartitionName(table, parts)
      const pendingName = derivePendingPartitionName(table, parts)
      await verificationPool.query(`drop table if exists "${partitionName}"`)
      await verificationPool.query(`drop table if exists "${pendingName}"`)
    }

    const dropAllPartitionArtifacts = async (dumpMonth: string): Promise<void> => {
      for (const table of observationParentTables) {
        await dropPartitionArtifacts(table, dumpMonth)
      }
    }

    beforeEach(async () => {
      await dropAllPartitionArtifacts(cleanDumpMonth)
      await dropAllPartitionArtifacts(repairDumpMonth)
      await dropPartitionArtifacts(mismatchTable, mismatchDumpMonth)
    })

    afterAll(async () => {
      await dropAllPartitionArtifacts(cleanDumpMonth)
      await dropAllPartitionArtifacts(repairDumpMonth)
      await dropPartitionArtifacts(mismatchTable, mismatchDumpMonth)
    })

    test('creates an exact RANGE partition for all nine Observation parents and is idempotent on rerun', async () => {
      const outcomes = await createUpcomingMonthPartitions(verificationPool, cleanDumpMonth)

      expect(
        outcomes
          .map((outcome) => outcome.table)
          .slice()
          .sort(),
      ).toEqual(observationParentTables.slice().sort())
      expect(
        outcomes.every(
          (outcome: CreateUpcomingMonthPartitionOutcome) => outcome.action === 'created',
        ),
      ).toBe(true)

      const parts = parseDumpMonth(cleanDumpMonth)
      const { lowerBoundUtc, upperBoundUtc } = computeDumpMonthBoundsUtc(parts)
      for (const table of observationParentTables) {
        const partitionName = deriveMonthlyPartitionName(table, parts)
        const info = await inspectPartitionCatalog(verificationPool, partitionName)
        // Proves, against the real catalog, that the created relation is directly attached to
        // its expected parent with exactly the expected JST-month UTC bounds.
        expect(() =>
          assertExactMonthlyPartitionBounds(partitionName, info, {
            parentTable: table,
            lowerBoundUtc,
            upperBoundUtc,
          }),
        ).not.toThrow()
      }

      // A row inserted afterwards routes directly to the new partition, not the DEFAULT.
      const shipPartitionName = deriveMonthlyPartitionName('create_ship_records', parts)
      await verificationPool.query(
        'insert into "create_ship_records" (ingested_at, ship_id) values ($1, $2)',
        [lowerBoundUtc, 4242],
      )
      const partitionRows = await verificationPool.query(
        `select count(*)::text as count from only "${shipPartitionName}"`,
      )
      expect(partitionRows.rows[0].count).toBe('1')
      const defaultRows = await verificationPool.query(
        'select count(*)::text as count from only "create_ship_records_default" where ingested_at >= $1 and ingested_at < $2',
        [lowerBoundUtc, upperBoundUtc],
      )
      expect(defaultRows.rows[0].count).toBe('0')

      // Rerunning is a safe no-op: every table already has its exact partition.
      const rerunOutcomes = await createUpcomingMonthPartitions(verificationPool, cleanDumpMonth)
      expect(rerunOutcomes.every((outcome) => outcome.action === 'already-exact')).toBe(true)
    })

    test('the catalog rejects a DEFAULT partition and a wrong expected parent', async () => {
      const defaultName = deriveDefaultPartitionName('create_ship_records')
      const info = await inspectPartitionCatalog(verificationPool, defaultName)
      const parts = parseDumpMonth(cleanDumpMonth)
      const { lowerBoundUtc, upperBoundUtc } = computeDumpMonthBoundsUtc(parts)

      expect(() =>
        assertExactMonthlyPartitionBounds(defaultName, info, {
          parentTable: 'create_ship_records',
          lowerBoundUtc,
          upperBoundUtc,
        }),
      ).toThrow(/DEFAULT partition/)

      // Also prove the "wrong parent" rejection using a real attached partition: create_ship's
      // own DEFAULT partition is really attached to create_ship_records, never to another table.
      expect(() =>
        assertExactMonthlyPartitionBounds(defaultName, info, {
          parentTable: 'create_item_records',
          lowerBoundUtc,
          upperBoundUtc,
        }),
      ).toThrow(/attached to parent/)
    })

    test('the catalog rejects a real multi-column ("extra expression") partition bound', async () => {
      await verificationPool.query('drop table if exists partition_catalog_scratch_parent cascade')
      try {
        await verificationPool.query(
          'create table partition_catalog_scratch_parent (a timestamptz not null, b integer not null) ' +
            'partition by range (a, b)',
        )
        await verificationPool.query(
          'create table partition_catalog_scratch_child partition of partition_catalog_scratch_parent ' +
            "for values from ('2099-01-01', 1) to ('2099-02-01', 1)",
        )

        const info = await inspectPartitionCatalog(
          verificationPool,
          'partition_catalog_scratch_child',
        )
        expect(info.relationExists).toBe(true)
        expect(info.parentTable).toBe('partition_catalog_scratch_parent')
        expect(info.isDefaultPartition).toBe(false)
        expect(info.lowerBoundUtc).toBeNull()
        expect(info.upperBoundUtc).toBeNull()

        expect(() =>
          assertExactMonthlyPartitionBounds('partition_catalog_scratch_child', info, {
            parentTable: 'partition_catalog_scratch_parent',
            lowerBoundUtc: new Date('2099-01-01T00:00:00.000Z'),
            upperBoundUtc: new Date('2099-02-01T00:00:00.000Z'),
          }),
        ).toThrow(/unexpected partition bound expression/)
      } finally {
        await verificationPool.query(
          'drop table if exists partition_catalog_scratch_parent cascade',
        )
      }
    })

    test('repairs a DEFAULT partition by moving only matching rows into a new exact monthly partition, preserving identity values, and is idempotent', async () => {
      const table = 'create_ship_records'
      const parts = parseDumpMonth(repairDumpMonth)
      const { lowerBoundUtc, upperBoundUtc } = computeDumpMonthBoundsUtc(parts)
      const partitionName = deriveMonthlyPartitionName(table, parts)
      const defaultName = deriveDefaultPartitionName(table)

      // Insert directly into the parent so PostgreSQL itself routes these rows into the DEFAULT
      // partition (no monthly partition exists for repairDumpMonth yet), and rely on the
      // partition's own identity sequence to capture the real generated ids.
      const insertedIds: string[] = []
      for (const shipId of [9001, 9002, 9003]) {
        const inserted = await verificationPool.query<{ id: string }>(
          'insert into "create_ship_records" (ingested_at, ship_id) values ($1, $2) returning id::text as id',
          [new Date(lowerBoundUtc.getTime() + shipId), shipId],
        )
        insertedIds.push(inserted.rows[0].id)
      }
      // A row outside the target month must never be touched by the repair.
      const untouched = await verificationPool.query<{ id: string }>(
        'insert into "create_ship_records" (ingested_at, ship_id) values ($1, $2) returning id::text as id',
        [new Date(upperBoundUtc.getTime() + 1000), 9999],
      )

      // create-upcoming-month must refuse to create a partition for this table while the
      // DEFAULT still has matching rows, and must direct the operator to the repair command.
      await expect(
        createUpcomingMonthPartitions(verificationPool, repairDumpMonth),
      ).rejects.toThrow(new RegExp(`${table}[\\s\\S]*repair`))

      const result = await repairMonthlyPartition(verificationPool, {
        table,
        dumpMonth: repairDumpMonth,
      })
      expect(result).toEqual({
        table,
        dumpMonth: repairDumpMonth,
        partitionName,
        action: 'attached',
        movedRowCount: 3,
      })

      const movedRows = await verificationPool.query<{ id: string }>(
        `select id::text as id from only "${partitionName}" order by id`,
      )
      expect(movedRows.rows.map((row) => row.id).sort()).toEqual(insertedIds.slice().sort())

      const remainingDefaultRows = await verificationPool.query<{ id: string }>(
        `select id::text as id from only "${defaultName}"`,
      )
      expect(remainingDefaultRows.rows.map((row) => row.id)).toEqual([untouched.rows[0].id])

      const info = await inspectPartitionCatalog(verificationPool, partitionName)
      expect(() =>
        assertExactMonthlyPartitionBounds(partitionName, info, {
          parentTable: table,
          lowerBoundUtc,
          upperBoundUtc,
        }),
      ).not.toThrow()

      // Idempotent rerun: the partition already exists and matches exactly, and there is
      // nothing left in the DEFAULT partition to move.
      const rerunResult = await repairMonthlyPartition(verificationPool, {
        table,
        dumpMonth: repairDumpMonth,
      })
      expect(rerunResult).toEqual({
        table,
        dumpMonth: repairDumpMonth,
        partitionName,
        action: 'already-attached',
        movedRowCount: 0,
      })
    })

    test('rolls back and rejects repair when a relation with the final partition name already exists but does not match', async () => {
      const parts = parseDumpMonth(mismatchDumpMonth)
      const { lowerBoundUtc } = computeDumpMonthBoundsUtc(parts)
      const partitionName = deriveMonthlyPartitionName(mismatchTable, parts)
      const defaultName = deriveDefaultPartitionName(mismatchTable)

      // Pre-create a same-named relation attached to the right parent, but with the *next*
      // month's bounds instead of mismatchDumpMonth's — a real, catalog-verifiable mismatch.
      const { lowerBoundUtc: wrongLower, upperBoundUtc: wrongUpper } = computeDumpMonthBoundsUtc(
        parseDumpMonth('2099-04'),
      )
      await verificationPool.query(
        `create table "${partitionName}" partition of "${mismatchTable}" ` +
          `for values from ('${wrongLower.toISOString()}'::timestamptz) to ('${wrongUpper.toISOString()}'::timestamptz)`,
      )

      const inserted = await verificationPool.query<{ id: string }>(
        'insert into "drop_ship_records" (ingested_at, ship_id) values ($1, $2) returning id::text as id',
        [lowerBoundUtc, 8001],
      )

      await expect(
        repairMonthlyPartition(verificationPool, {
          table: mismatchTable,
          dumpMonth: mismatchDumpMonth,
        }),
      ).rejects.toThrow(PartitionCatalogMismatchError)

      // Nothing was moved: the row is still exactly where it started, in the DEFAULT partition.
      const stillInDefault = await verificationPool.query<{ id: string }>(
        `select id::text as id from only "${defaultName}"`,
      )
      expect(stillInDefault.rows.map((row) => row.id)).toEqual([inserted.rows[0].id])
    })

    test('rejects an unsafe table before ever connecting to PostgreSQL', async () => {
      await expect(
        repairMonthlyPartition(verificationPool, {
          table: 'data_dump_files',
          dumpMonth: cleanDumpMonth,
        }),
      ).rejects.toThrow(PartitionMaintenanceError)
    })
  })
})
