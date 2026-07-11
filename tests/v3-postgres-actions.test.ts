import { is, sql, SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import {
  itemImprovementAvailabilityFacts,
  itemImprovementCostFacts,
  itemImprovementUpdateFacts,
  quests,
  questRewards,
} from '../src/db/postgres/schema'
import { type AppRequest } from '../src/http/request'

const captureExceptionMock = vi.hoisted(() => vi.fn())
vi.mock('../src/sentry', () => ({ captureException: captureExceptionMock }))

// Runs every mapped item serially but still records the concurrency option it was called with,
// so tests can assert PostgreSQL's lower ingest concurrency (5) without depending on bluebird's
// actual scheduling behavior.
const bluebirdMapMock = vi.hoisted(() =>
  vi.fn(
    async (
      items: unknown[],
      iterator: (item: unknown) => unknown,
      options?: { concurrency: number },
    ) => {
      void options
      const results = []
      for (const item of items) {
        results.push(await iterator(item))
      }
      return results
    },
  ),
)
vi.mock('bluebird', () => ({ default: { map: bluebirdMapMock } }))

import {
  appendDistinctInOrder,
  buildAvailabilityExportQuery,
  buildCostExportQuery,
  buildUpdateExportQuery,
  createPostgresV3Actions,
} from '../src/controllers/api/report/v3.postgres.actions'

const dialect = new PgDialect()
const normalizeSql = (text: string) => text.replace(/\s+/g, ' ').trim()
const compile = (query: SQL) => {
  const compiled = dialect.sqlToQuery(query)
  return { params: compiled.params, sql: normalizeSql(compiled.sql) }
}

const epoch = { id: 'postgres-epoch-1', startedAt: '2026-01-01T00:00:00.000Z' }

const createRequest = (overrides: Partial<AppRequest> = {}): AppRequest => ({
  body: {},
  headers: {},
  log: { warn: vi.fn() },
  method: 'POST',
  params: {},
  path: '/api/report/v3/test',
  query: {},
  url: '/api/report/v3/test',
  ...overrides,
})

const postBody = (data: unknown, headers: Record<string, string> = {}) =>
  createRequest({
    body: { data: JSON.stringify(data) },
    headers,
  })

const getExport = (path: string, query: Record<string, string | undefined> = {}) =>
  createRequest({ method: 'GET', path, query, url: path })

// Minimal thenable chain fake mirroring Drizzle's insert/values/onConflict API shape (see
// tests/v2-postgres-actions.test.ts's `createChain`, extended with `onConflictDoNothing` for the
// insert-only quest/quest_reward writes).
interface FakeInsertChain {
  onConflictDoNothingArg?: unknown
  onConflictDoUpdateArg?: unknown
  table: unknown
  valuesArg?: unknown
  onConflictDoNothing: ReturnType<typeof vi.fn>
  onConflictDoUpdate: ReturnType<typeof vi.fn>
  returning: ReturnType<typeof vi.fn>
  then: (resolve: (value: unknown) => unknown) => unknown
  values: ReturnType<typeof vi.fn>
}

const createInsertChain = (table: unknown, returningRows?: unknown[]): FakeInsertChain => {
  const chain = { table } as FakeInsertChain
  chain.then = (resolve) => Promise.resolve(undefined).then(resolve)
  chain.values = vi.fn((value: unknown) => {
    chain.valuesArg = value
    return chain
  })
  chain.onConflictDoUpdate = vi.fn((config: unknown) => {
    chain.onConflictDoUpdateArg = config
    return chain
  })
  chain.onConflictDoNothing = vi.fn((config: unknown) => {
    chain.onConflictDoNothingArg = config
    return chain
  })
  chain.returning = vi.fn(() => {
    if (returningRows != null) {
      return Promise.resolve(returningRows)
    }
    const values = chain.valuesArg as { title?: string; detail?: string } | undefined
    return Promise.resolve([{ title: values?.title, detail: values?.detail }])
  })
  return chain
}

const createFakeDb = (
  options: {
    definitionReturningRows?: unknown[]
    selectDistinctRows?: unknown[]
    executeRows?: unknown[]
  } = {},
) => {
  const insertChains: FakeInsertChain[] = []
  const insert = vi.fn((table: unknown) => {
    const chain = createInsertChain(table, options.definitionReturningRows)
    insertChains.push(chain)
    return chain
  })
  const from = vi.fn(() => Promise.resolve(options.selectDistinctRows ?? []))
  const selectDistinct = vi.fn(() => ({ from }))
  const execute = vi.fn((query: unknown) => {
    void query
    return Promise.resolve({ rows: options.executeRows ?? [] })
  })
  return {
    db: { execute, insert, selectDistinct },
    execute,
    from,
    insert,
    insertChains,
    selectDistinct,
  }
}

describe('appendDistinctInOrder', () => {
  test('appends only not-yet-present text elements, preserving incoming order', () => {
    const { params, sql: text } = compile(
      appendDistinctInOrder(itemImprovementAvailabilityFacts.sources, ['plugin'], 'text'),
    )

    expect(text).toBe(
      '("item_improvement_availability_facts"."sources" || coalesce((select array_agg(t.value order by t.ord) from unnest(array[$1]::text[]) with ordinality as t(value, ord) where not (t.value = any("item_improvement_availability_facts"."sources"))), array[]::text[]))',
    )
    expect(params).toEqual(['plugin'])
  })

  test('appends integer elements in incoming order', () => {
    const { params, sql: text } = compile(
      appendDistinctInOrder(
        itemImprovementAvailabilityFacts.observedFlagshipIds,
        [101, 103],
        'integer',
      ),
    )

    expect(text).toContain('unnest(array[$1, $2]::integer[])')
    expect(text).toContain(
      't.value = any("item_improvement_availability_facts"."observed_flagship_ids")',
    )
    expect(params).toEqual([101, 103])
  })

  test('coalesces to an empty array literal (never emits a bare NULL) when incoming is empty', () => {
    const { params, sql: text } = compile(
      appendDistinctInOrder(itemImprovementAvailabilityFacts.origins, [], 'text'),
    )

    expect(text).toContain('unnest(array[]::text[])')
    expect(text).toContain('array[]::text[]))')
    expect(params).toEqual([])
  })
})

describe('export query builders', () => {
  test('captures clock_timestamp() once via a materialized one-row CTE and excludes rows newer than cutoff - 30s', () => {
    const { sql: text } = compile(buildAvailabilityExportQuery({ updatedAfter: 0, limit: 500 }))

    expect(text).toContain(
      "with settled as materialized (select clock_timestamp() - interval '30 seconds' as cutoff)",
    )
    expect(text).toContain(
      '"item_improvement_availability_facts"."last_reported" <= (extract(epoch from settled.cutoff) * 1000)::bigint',
    )
    expect(text).toContain('cross join settled')
  })

  test('filters by updatedAfter alone when no afterId cursor is given', () => {
    const { params, sql: text } = compile(
      buildAvailabilityExportQuery({ updatedAfter: 1000, limit: 500 }),
    )

    expect(text).toContain('"item_improvement_availability_facts"."last_reported" > $1)')
    expect(text).not.toContain('or (')
    expect(params).toEqual([1000, 500])
  })

  test('filters by (lastReported, exportId) tie-break when an afterId cursor is given', () => {
    const { params, sql: text } = compile(
      buildAvailabilityExportQuery({ afterId: 'abc123', updatedAfter: 1000, limit: 500 }),
    )

    expect(text).toContain(
      '("item_improvement_availability_facts"."last_reported" > $1 or ("item_improvement_availability_facts"."last_reported" = $2 and "item_improvement_availability_facts"."export_id" > $3))',
    )
    expect(params).toEqual([1000, 1000, 'abc123', 500])
  })

  test('orders by (last_reported, export_id) ascending and applies the clamped limit', () => {
    const { params, sql: text } = compile(
      buildAvailabilityExportQuery({ updatedAfter: 0, limit: 7 }),
    )

    expect(text).toContain(
      'order by "item_improvement_availability_facts"."last_reported" asc, "item_improvement_availability_facts"."export_id" asc limit $2',
    )
    expect(params[1]).toBe(7)
  })

  test('selects the explicit public column list, excluding origins and the internal id column', () => {
    const { sql: text } = compile(buildAvailabilityExportQuery({ updatedAfter: 0, limit: 500 }))

    expect(text).not.toContain('origins')
    expect(text).not.toContain('.id as')
    expect(text).toContain('"item_improvement_availability_facts"."export_id" as export_id')
  })

  test('cost export selects the base columns plus cost-specific columns', () => {
    const { sql: text } = compile(buildCostExportQuery({ updatedAfter: 0, limit: 500 }))

    expect(text).toContain('from "item_improvement_cost_facts" cross join settled')
    expect(text).toContain('"item_improvement_cost_facts"."req_slot_items" as req_slot_items')
    expect(text).toContain('"item_improvement_cost_facts"."req_use_items" as req_use_items')
    expect(text).toContain('"item_improvement_cost_facts"."change_flag" as change_flag')
    expect(text).not.toContain('origins')
  })

  test('update export selects the base columns plus upgrade-specific columns', () => {
    const { sql: text } = compile(buildUpdateExportQuery({ updatedAfter: 0, limit: 500 }))

    expect(text).toContain('from "item_improvement_update_facts" cross join settled')
    expect(text).toContain(
      '"item_improvement_update_facts"."upgrade_to_item_id" as upgrade_to_item_id',
    )
    expect(text).toContain(
      '"item_improvement_update_facts"."upgrade_to_item_level" as upgrade_to_item_level',
    )
    expect(text).toContain('"item_improvement_update_facts"."upgrade_observed" as upgrade_observed')
    expect(text).not.toContain('origins')
  })
})

const CLIENT_OBSERVED_AT = 1_700_000_000_000

// 1_700_000_000_000 ms is 2023-11-14T22:13:20Z, which is JST day 3 (Wednesday, since JST is
// UTC+9 and the "day" rolls over at 15:00 UTC / 00:00 JST).
const CLIENT_OBSERVED_AT_DAY = 3

const availabilityPayload = {
  clientObservedAt: CLIENT_OBSERVED_AT,
  day: CLIENT_OBSERVED_AT_DAY,
  itemId: 700,
  observedFlagshipId: 101,
  observedSecondShipId: 0,
  recipeId: 33,
  schemaVersion: 1,
  source: 'list' as const,
}

describe('createPostgresV3Actions: itemImprovementRecipe ingest', () => {
  // Pin "now" to CLIENT_OBSERVED_AT so the production code's `Date.now()`-derived
  // serverReceivedAt always agrees with the fixture's JST day, independent of real wall-clock time.
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(CLIENT_OBSERVED_AT)
    bluebirdMapMock.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('normalizes a single availability record into one insert/onConflictDoUpdate write', async () => {
    const { db, insert, insertChains } = createFakeDb()
    const actions = createPostgresV3Actions(db as never, epoch)

    const result = await actions.itemImprovementRecipe(postBody(availabilityPayload))

    expect(result).toEqual({ body: { records: 1 }, status: 200 })
    expect(insert).toHaveBeenCalledTimes(1)
    expect(insert).toHaveBeenCalledWith(itemImprovementAvailabilityFacts)

    const chain = insertChains[0]
    const valuesArg = chain.valuesArg as Record<string, unknown>
    expect(valuesArg).toMatchObject({
      day: CLIENT_OBSERVED_AT_DAY,
      itemId: 700,
      key: 'v1|availability|33|700|3|0',
      observedFlagshipIds: [101],
      observedSecondShipId: 0,
      origins: [],
      recipeId: 33,
      schemaVersion: 1,
      sources: ['list'],
    })
    expect(valuesArg.firstClientObservedAt).toBe(CLIENT_OBSERVED_AT)
    expect(valuesArg.lastClientObservedAt).toBe(CLIENT_OBSERVED_AT)
    expect(is(valuesArg.firstReported, SQL)).toBe(true)
    expect(is(valuesArg.lastReported, SQL)).toBe(true)
    expect(valuesArg.firstReported).toEqual(valuesArg.lastReported)

    expect(chain.onConflictDoUpdateArg).toMatchObject({
      target: itemImprovementAvailabilityFacts.key,
    })
    const setArg = (chain.onConflictDoUpdateArg as { set: Record<string, unknown> }).set
    expect(setArg).not.toHaveProperty('key')
    expect(setArg).not.toHaveProperty('schemaVersion')
    expect(setArg).not.toHaveProperty('recipeId')
    expect(setArg).not.toHaveProperty('firstReported')
    expect(setArg.lastReported).toEqual(
      sql`greatest(${itemImprovementAvailabilityFacts.lastReported}, ${valuesArg.lastReported})`,
    )
    expect(setArg.firstClientObservedAt).toEqual(
      sql`least(${itemImprovementAvailabilityFacts.firstClientObservedAt}, ${CLIENT_OBSERVED_AT})`,
    )
    expect(setArg.lastClientObservedAt).toEqual(
      sql`greatest(${itemImprovementAvailabilityFacts.lastClientObservedAt}, ${CLIENT_OBSERVED_AT})`,
    )
    expect(setArg.count).toEqual(sql`${itemImprovementAvailabilityFacts.count} + 1`)
    expect(setArg.sources).toEqual(
      appendDistinctInOrder(itemImprovementAvailabilityFacts.sources, ['list'], 'text'),
    )
    expect(setArg.origins).toEqual(
      appendDistinctInOrder(itemImprovementAvailabilityFacts.origins, [], 'text'),
    )
    expect(setArg.observedFlagshipIds).toEqual(
      appendDistinctInOrder(itemImprovementAvailabilityFacts.observedFlagshipIds, [101], 'integer'),
    )
  })

  test('includes the x-reporter origin in both insert values and the append-if-absent union', async () => {
    const { db, insertChains } = createFakeDb()
    const actions = createPostgresV3Actions(db as never, epoch)

    await actions.itemImprovementRecipe(
      postBody(availabilityPayload, { 'x-reporter': 'Reporter/1.0.0' }),
    )

    const chain = insertChains[0]
    expect((chain.valuesArg as Record<string, unknown>).origins).toEqual(['Reporter/1.0.0'])
    const setArg = (chain.onConflictDoUpdateArg as { set: Record<string, unknown> }).set
    expect(setArg.origins).toEqual(
      appendDistinctInOrder(itemImprovementAvailabilityFacts.origins, ['Reporter/1.0.0'], 'text'),
    )
  })

  test('normalizes a detail record into a cost fact write with all declared cost columns', async () => {
    const { db, insert, insertChains } = createFakeDb()
    const actions = createPostgresV3Actions(db as never, epoch)

    const result = await actions.itemImprovementRecipe(
      postBody({
        ammo: 20,
        bauxite: 40,
        buildkit: 3,
        certainBuildkit: 5,
        certainRemodelkit: 6,
        clientObservedAt: CLIENT_OBSERVED_AT,
        day: CLIENT_OBSERVED_AT_DAY,
        fuel: 10,
        itemId: 700,
        itemLevel: 6,
        observedFlagshipId: 101,
        observedSecondShipId: 0,
        recipeId: 33,
        remodelkit: 4,
        reqSlotItems: [{ count: 2, id: 90 }],
        reqUseItems: [{ count: 1, id: 65 }],
        schemaVersion: 1,
        source: 'detail',
        stage: 1,
        steel: 30,
      }),
    )

    expect(result).toEqual({ body: { records: 1 }, status: 200 })
    expect(insert).toHaveBeenCalledWith(itemImprovementCostFacts)
    const valuesArg = insertChains[0].valuesArg as Record<string, unknown>
    expect(valuesArg).toMatchObject({
      ammo: 20,
      bauxite: 40,
      buildkit: 3,
      certainBuildkit: 5,
      certainRemodelkit: 6,
      changeFlag: 0,
      fuel: 10,
      itemLevel: 6,
      key: 'v1|cost|33|700|6|1|3|0|10|20|30|40|3|4|5|6|90:2|65:1|0',
      remodelkit: 4,
      reqSlotItems: [{ count: 2, id: 90 }],
      reqUseItems: [{ count: 1, id: 65 }],
      stage: 1,
      steel: 30,
    })
  })

  test('normalizes an execution record into an update fact write with upgrade fields', async () => {
    const { db, insert, insertChains } = createFakeDb()
    const actions = createPostgresV3Actions(db as never, epoch)

    const result = await actions.itemImprovementRecipe(
      postBody({
        clientObservedAt: CLIENT_OBSERVED_AT,
        day: CLIENT_OBSERVED_AT_DAY,
        itemId: 700,
        itemLevel: 6,
        observedFlagshipId: 101,
        observedSecondShipId: 0,
        recipeId: 33,
        schemaVersion: 1,
        source: 'execution',
        upgradeObserved: true,
        upgradeToItemId: 701,
        upgradeToItemLevel: 7,
      }),
    )

    expect(result).toEqual({ body: { records: 1 }, status: 200 })
    expect(insert).toHaveBeenCalledWith(itemImprovementUpdateFacts)
    const valuesArg = insertChains[0].valuesArg as Record<string, unknown>
    expect(valuesArg).toMatchObject({
      itemLevel: 6,
      key: 'v1|update|33|700|6|3|0|701|7',
      upgradeObserved: true,
      upgradeToItemId: 701,
      upgradeToItemLevel: 7,
    })
    expect(valuesArg.firstReported).toEqual(valuesArg.lastReported)
    const setArg = (
      insertChains[0].onConflictDoUpdateArg as {
        set: Record<string, unknown>
      }
    ).set
    expect(setArg.lastReported).toEqual(
      sql`greatest(${itemImprovementUpdateFacts.lastReported}, ${valuesArg.lastReported})`,
    )
  })

  test('writes a mixed batch with per-record concurrency 5', async () => {
    const { db, insert } = createFakeDb()
    const actions = createPostgresV3Actions(db as never, epoch)

    const result = await actions.itemImprovementRecipe(
      postBody({
        records: [
          availabilityPayload,
          { ...availabilityPayload, observedFlagshipId: 102 },
          { ...availabilityPayload, observedFlagshipId: 103 },
        ],
      }),
    )

    expect(result).toEqual({ body: { records: 3 }, status: 200 })
    expect(insert).toHaveBeenCalledTimes(3)
    expect(bluebirdMapMock).toHaveBeenCalledTimes(1)
    expect(bluebirdMapMock.mock.calls[0][2]).toEqual({ concurrency: 5 })
  })

  test('rejects a batch of 101 records with 400 and performs no writes', async () => {
    const { db, insert } = createFakeDb()
    const actions = createPostgresV3Actions(db as never, epoch)
    const records = Array.from({ length: 101 }, () => availabilityPayload)

    const result = await actions.itemImprovementRecipe(postBody({ records }))

    expect(result.status).toBe(400)
    expect(insert).not.toHaveBeenCalled()
  })

  test('rejects an invalid record with 400 and does not write', async () => {
    const { db, insert } = createFakeDb()
    const actions = createPostgresV3Actions(db as never, epoch)

    const result = await actions.itemImprovementRecipe(
      postBody({ ...availabilityPayload, recipeId: -1 }),
    )

    expect(result.status).toBe(400)
    expect(insert).not.toHaveBeenCalled()
  })
})

describe('createPostgresV3Actions: item-improvement exports', () => {
  const rawRow = {
    count: '3',
    day: 6,
    export_id: '00000000000000000001a2b3',
    first_client_observed_at: '1000',
    first_reported: '2000',
    item_id: 700,
    key: 'v1|availability|33|700|6|0',
    last_client_observed_at: '1500',
    last_reported: '2500',
    observed_flagship_ids: [101, 103],
    observed_second_ship_id: 0,
    recipe_id: 33,
    schema_version: 1,
    sources: ['list'],
  }

  test('runs the availability export query and shapes the public response', async () => {
    const { db, execute } = createFakeDb({ executeRows: [rawRow] })
    const actions = createPostgresV3Actions(db as never, epoch)

    const result = await actions.itemImprovementRecipeAvailability(
      getExport('/api/report/v3/item_improvement_recipes/availability', {
        limit: '5000',
        updatedAfter: '1000',
      }),
    )

    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute.mock.calls[0][0]).toEqual(
      buildAvailabilityExportQuery({ updatedAfter: 1000, limit: 1000 }),
    )
    expect(result.status).toBe(200)
    expect(result.body).toEqual({
      epoch,
      next: { afterId: '00000000000000000001a2b3', updatedAfter: 2500 },
      records: [
        {
          _id: '00000000000000000001a2b3',
          count: 3,
          day: 6,
          firstClientObservedAt: 1000,
          firstReported: 2000,
          itemId: 700,
          key: 'v1|availability|33|700|6|0',
          lastClientObservedAt: 1500,
          lastReported: 2500,
          observedFlagshipIds: [101, 103],
          observedSecondShipId: 0,
          recipeId: 33,
          schemaVersion: 1,
          sources: ['list'],
        },
      ],
    })
    expect(result.headers).toMatchObject({ 'Cache-Control': 'public, max-age=60' })
  })

  test('passes the afterId cursor through to the compiled query', async () => {
    const { db, execute } = createFakeDb({ executeRows: [] })
    const actions = createPostgresV3Actions(db as never, epoch)

    await actions.itemImprovementRecipeAvailability(
      getExport('/api/report/v3/item_improvement_recipes/availability', {
        afterId: '00000000000000000001a2b3',
        updatedAfter: '1000',
      }),
    )

    expect(execute.mock.calls[0][0]).toEqual(
      buildAvailabilityExportQuery({
        afterId: '00000000000000000001a2b3',
        updatedAfter: 1000,
        limit: 500,
      }),
    )
  })

  test('returns an empty page with a null cursor and never calls execute for an invalid afterId', async () => {
    const { db, execute } = createFakeDb()
    const actions = createPostgresV3Actions(db as never, epoch)

    const invalidResult = await actions.itemImprovementRecipeAvailability(
      getExport('/api/report/v3/item_improvement_recipes/availability', {
        afterId: 'not-an-object-id',
      }),
    )
    expect(invalidResult.status).toBe(400)
    expect(execute).not.toHaveBeenCalled()

    const emptyResult = await actions.itemImprovementRecipeAvailability(
      getExport('/api/report/v3/item_improvement_recipes/availability'),
    )
    expect(emptyResult.body).toMatchObject({ next: null, records: [] })
  })

  test('runs the cost export query and round-trips required-item JSON plus stable arrays', async () => {
    const { db, execute } = createFakeDb({
      executeRows: [
        {
          ...rawRow,
          ammo: 20,
          bauxite: 40,
          buildkit: 3,
          certain_buildkit: 5,
          certain_remodelkit: 6,
          change_flag: 0,
          fuel: 10,
          item_level: 6,
          remodelkit: 4,
          req_slot_items: [{ count: 2, id: 90 }],
          req_use_items: [{ count: 1, id: 65 }],
          stage: 1,
          steel: 30,
        },
      ],
    })
    const actions = createPostgresV3Actions(db as never, epoch)

    const result = await actions.itemImprovementRecipeCosts(
      getExport('/api/report/v3/item_improvement_recipes/costs'),
    )

    expect(execute.mock.calls[0][0]).toEqual(buildCostExportQuery({ updatedAfter: 0, limit: 500 }))
    expect(result.body).toMatchObject({
      records: [
        expect.objectContaining({
          ammo: 20,
          bauxite: 40,
          buildkit: 3,
          certainBuildkit: 5,
          certainRemodelkit: 6,
          changeFlag: 0,
          fuel: 10,
          itemLevel: 6,
          remodelkit: 4,
          reqSlotItems: [{ count: 2, id: 90 }],
          reqUseItems: [{ count: 1, id: 65 }],
          stage: 1,
          steel: 30,
        }),
      ],
    })
  })

  test('runs the update export query and includes upgrade fields', async () => {
    const { db, execute } = createFakeDb({
      executeRows: [
        {
          ...rawRow,
          item_level: 6,
          upgrade_observed: true,
          upgrade_to_item_id: 701,
          upgrade_to_item_level: 7,
        },
      ],
    })
    const actions = createPostgresV3Actions(db as never, epoch)

    const result = await actions.itemImprovementRecipeUpdates(
      getExport('/api/report/v3/item_improvement_recipes/updates'),
    )

    expect(execute.mock.calls[0][0]).toEqual(
      buildUpdateExportQuery({ updatedAfter: 0, limit: 500 }),
    )
    expect(result.body).toMatchObject({
      records: [
        expect.objectContaining({
          itemLevel: 6,
          upgradeObserved: true,
          upgradeToItemId: 701,
          upgradeToItemLevel: 7,
        }),
      ],
    })
  })
})

describe('createPostgresV3Actions: knownQuests', () => {
  test('returns unsorted, unde-duplicated 8-character key prefixes with Cloudflare cache headers', async () => {
    const { db, from, selectDistinct } = createFakeDb({
      selectDistinctRows: [
        { key: 'bbbbbbbbaaaaaaaaaaaaaaaaaaaaaaaa' },
        { key: 'aaaaaaaabbbbbbbbbbbbbbbbbbbbbbbb' },
        { key: 'aaaaaaaacccccccccccccccccccccccc' },
      ],
    })
    const actions = createPostgresV3Actions(db as never, epoch)

    const result = await actions.knownQuests(getExport('/api/report/v3/known_quests'))

    expect(selectDistinct).toHaveBeenCalledWith({ key: quests.key })
    expect(from).toHaveBeenCalledWith(quests)
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ quests: ['bbbbbbbb', 'aaaaaaaa', 'aaaaaaaa'] })
    expect(result.headers).toMatchObject({ 'Cache-Control': 'public, max-age=60' })
  })
})

describe('createPostgresV3Actions: quest', () => {
  test('inserts every quest with an MD5 title/detail key and insert-only conflict handling', async () => {
    const { db, insert, insertChains } = createFakeDb()
    const actions = createPostgresV3Actions(db as never, epoch)

    const result = await actions.quest(
      postBody(
        {
          origin: 'poi',
          quests: [
            { category: 1, detail: 'detail-a', questId: 101, title: 'title-a', type: 1 },
            { category: 2, detail: 'detail-b', questId: 102, title: 'title-b', type: 2 },
          ],
        },
        { 'x-reporter': 'Reporter/1.0.0' },
      ),
    )

    expect(result).toEqual({ body: undefined, status: 200 })
    expect(insert).toHaveBeenCalledTimes(2)
    expect(insert).toHaveBeenCalledWith(quests)

    const firstValues = insertChains[0].valuesArg as Record<string, unknown>
    expect(firstValues).toEqual({
      category: 1,
      detail: 'detail-a',
      key: expect.stringMatching(/^[0-9a-f]{32}$/),
      origin: 'poi',
      questId: 101,
      title: 'title-a',
      type: 1,
    })
    expect(insertChains[0].onConflictDoUpdateArg).toMatchObject({
      target: [quests.key, quests.questId, quests.category],
    })
    expect(insertChains[0].onConflictDoUpdateArg).toHaveProperty('setWhere')

    const secondValues = insertChains[1].valuesArg as Record<string, unknown>
    expect(secondValues.key).not.toBe(firstValues.key)
  })

  test('produces the same key for identical title/detail pairs regardless of questId', async () => {
    const { db, insertChains } = createFakeDb()
    const actions = createPostgresV3Actions(db as never, epoch)

    await actions.quest(
      postBody({
        quests: [
          { category: 1, detail: 'same-detail', questId: 1, title: 'same-title' },
          { category: 1, detail: 'same-detail', questId: 2, title: 'same-title' },
        ],
      }),
    )

    const firstKey = (insertChains[0].valuesArg as { key: string }).key
    const secondKey = (insertChains[1].valuesArg as { key: string }).key
    expect(firstKey).toBe(secondKey)
  })
})

describe('createPostgresV3Actions: questReward', () => {
  test('accepts legacy bounsCount and stores it via the bonusCount schema field', async () => {
    const { db, insert, insertChains } = createFakeDb()
    const actions = createPostgresV3Actions(db as never, epoch)

    const result = await actions.questReward(
      postBody({
        bonus: [{ itemId: 1 }],
        bounsCount: 3,
        category: 1,
        detail: 'reward-detail',
        material: [1, 2],
        questId: 55,
        selections: [1, 2],
        title: 'reward-title',
        type: 1,
      }),
    )

    expect(result).toEqual({ body: undefined, status: 200 })
    expect(insert).toHaveBeenCalledWith(questRewards)
    const valuesArg = insertChains[0].valuesArg as Record<string, unknown>
    expect(valuesArg).toEqual({
      bonus: [{ itemId: 1 }],
      bonusCount: 3,
      category: 1,
      detail: 'reward-detail',
      key: expect.stringMatching(/^[0-9a-f]{32}$/),
      material: [1, 2],
      origin: '',
      questId: 55,
      selections: [1, 2],
      title: 'reward-title',
      type: 1,
    })
    expect(insertChains[0].onConflictDoUpdateArg).toMatchObject({
      target: [
        questRewards.key,
        questRewards.questId,
        questRewards.selections,
        questRewards.bonusCount,
      ],
    })
    expect(insertChains[0].onConflictDoUpdateArg).toHaveProperty('setWhere')
  })

  test('rejects a quest reward hash collision without accepting the conflicting definition', async () => {
    const { db } = createFakeDb({ definitionReturningRows: [] })
    const actions = createPostgresV3Actions(db as never, epoch)

    const result = await actions.questReward(
      postBody({
        bounsCount: 1,
        detail: 'detail',
        questId: 55,
        selections: [1],
        title: 'title',
      }),
    )

    expect(result.status).toBe(500)
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('identity hash collision') }),
      expect.anything(),
    )
  })
})
