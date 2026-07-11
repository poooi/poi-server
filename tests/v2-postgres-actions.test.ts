import { createHash } from 'crypto'

import { sql, is, SQL } from 'drizzle-orm'
import { describe, expect, test, vi } from 'vitest'

import {
  aaciRecords,
  battleApis,
  createItemRecords,
  createShipRecords,
  dropShipRecords,
  enemyInfos,
  nightBattleCis,
  nightContacts,
  recipeRecords,
  selectRankRecords,
  shipStats,
} from '../src/db/postgres/schema'
import { type AppRequest } from '../src/http/request'

const captureExceptionMock = vi.hoisted(() => vi.fn())
vi.mock('../src/sentry', () => ({ captureException: captureExceptionMock }))

import {
  computeEnemyInfoIdentityHash,
  createPostgresV2Actions,
  pickPresentFields,
} from '../src/controllers/api/report/v2.postgres.actions'

const createRequest = (overrides: Partial<AppRequest> = {}): AppRequest => ({
  body: {},
  headers: {},
  log: { warn: vi.fn() },
  method: 'POST',
  params: {},
  path: '/api/report/v2/test',
  query: {},
  url: '/api/report/v2/test',
  ...overrides,
})

const postBody = (data: unknown, headers: Record<string, string> = {}) =>
  createRequest({
    body: { data: JSON.stringify(data) },
    headers,
  })

// Minimal thenable chain fake mirroring Drizzle's insert/onConflictDoUpdate/returning API shape.
// `then` lets `await db.insert(...).values(...)` resolve without an explicit `.returning()` call.
const createChain = (returningRows: unknown[] = []) => {
  const chain: {
    onConflictArg?: unknown
    returningArg?: unknown
    valuesArg?: unknown
    onConflictDoUpdate: ReturnType<typeof vi.fn>
    returning: ReturnType<typeof vi.fn>
    then: (resolve: (value: unknown) => unknown) => unknown
    values: ReturnType<typeof vi.fn>
  } = {
    onConflictDoUpdate: vi.fn(),
    returning: vi.fn(),
    then: (resolve) => Promise.resolve(undefined).then(resolve),
    values: vi.fn(),
  }
  chain.values = vi.fn((value: unknown) => {
    chain.valuesArg = value
    return chain
  })
  chain.onConflictDoUpdate = vi.fn((config: unknown) => {
    chain.onConflictArg = config
    return chain
  })
  chain.returning = vi.fn((selection?: unknown) => {
    chain.returningArg = selection
    return Promise.resolve(returningRows)
  })
  return chain
}

const createFakeDb = (
  options: { returningRows?: unknown[]; selectDistinctRows?: unknown[] } = {},
) => {
  const insertChain = createChain(options.returningRows ?? [])
  const insert = vi.fn(() => insertChain)
  const from = vi.fn(() => Promise.resolve(options.selectDistinctRows ?? []))
  const selectDistinct = vi.fn(() => ({ from }))
  return { db: { insert, selectDistinct }, from, insert, insertChain, selectDistinct }
}

describe('pickPresentFields', () => {
  test('includes only keys present on the source object, preserving explicit null', () => {
    const info: Record<string, unknown> = { a: 1, b: null }
    expect(pickPresentFields(info, ['a', 'b', 'c'])).toEqual({ a: 1, b: null })
  })

  test('returns an empty object when no listed fields are present', () => {
    expect(pickPresentFields({}, ['a', 'b'])).toEqual({})
  })
})

describe('computeEnemyInfoIdentityHash', () => {
  const components = {
    equips1: [[3]],
    equips2: [[4]],
    hp1: [10],
    hp2: [20],
    levels1: [1],
    levels2: [2],
    planes: 10,
    ships1: [1],
    ships2: [2],
    stats1: [[1]],
    stats2: [[2]],
  }

  test('hashes the canonical ordered tuple with SHA-256', () => {
    const expected = createHash('sha256')
      .update(
        JSON.stringify([
          components.ships1,
          components.levels1,
          components.hp1,
          components.stats1,
          components.equips1,
          components.ships2,
          components.levels2,
          components.hp2,
          components.stats2,
          components.equips2,
          components.planes,
        ]),
      )
      .digest()

    expect(computeEnemyInfoIdentityHash(components)).toEqual(expected)
  })

  test('is sensitive to fleet element order', () => {
    const reordered = { ...components, ships1: [9, 1] }
    expect(computeEnemyInfoIdentityHash(reordered)).not.toEqual(
      computeEnemyInfoIdentityHash({ ...components, ships1: [1, 9] }),
    )
  })
})

describe('createPostgresV2Actions: declared-field-only observation inserts', () => {
  test('createShip inserts only declared fields', async () => {
    const { db, insert, insertChain } = createFakeDb()
    const actions = createPostgresV2Actions(db as never)

    const result = await actions.createShip(
      postBody({
        items: [1, 2],
        kdockId: 3,
        secretary: 4,
        shipId: 5,
        highspeed: 1,
        teitokuLv: 99,
        largeFlag: true,
        unknownField: 'discard me',
      }),
    )

    expect(result).toEqual({ body: undefined, status: 200 })
    expect(insert).toHaveBeenCalledWith(createShipRecords)
    expect(insertChain.valuesArg).toEqual({
      items: [1, 2],
      kdockId: 3,
      secretary: 4,
      shipId: 5,
      highspeed: 1,
      teitokuLv: 99,
      largeFlag: true,
      origin: '',
    })
  })

  test('createItem inserts declared fields with shared casting', async () => {
    const { db, insert, insertChain } = createFakeDb()
    const actions = createPostgresV2Actions(db as never)

    const result = await actions.createItem(
      postBody({ items: '7', itemId: '8', successful: 'yes' }),
    )

    expect(result.status).toBe(200)
    expect(insert).toHaveBeenCalledWith(createItemRecords)
    expect(insertChain.valuesArg).toEqual({
      items: [7],
      secretary: undefined,
      itemId: 8,
      teitokuLv: undefined,
      successful: true,
      origin: '',
    })
  })

  test('remodelItem discards injected origin, matching the legacy schema', async () => {
    const { db, insertChain } = createFakeDb()
    const actions = createPostgresV2Actions(db as never)

    await actions.remodelItem(postBody({ successful: true, itemId: 1 }))

    expect(insertChain.valuesArg).not.toHaveProperty('origin')
  })

  test('passEvent defaults omitted rewards to an empty array', async () => {
    const { db, insertChain } = createFakeDb()
    const actions = createPostgresV2Actions(db as never)

    await actions.passEvent(postBody({ teitokuId: 'admiral-1' }))

    expect(insertChain.valuesArg).toMatchObject({ rewards: [] })
  })

  test('battleApi persists declared path/origin/data', async () => {
    const { db, insert, insertChain } = createFakeDb()
    const actions = createPostgresV2Actions(db as never)

    await actions.battleApi(postBody({ path: '/kcsapi/x', data: { a: 1 } }))

    expect(insert).toHaveBeenCalledWith(battleApis)
    expect(insertChain.valuesArg).toEqual({ origin: '', path: '/kcsapi/x', data: { a: 1 } })
  })

  test('nightContact discards injected origin, matching the legacy schema', async () => {
    const { db, insert, insertChain } = createFakeDb()
    const actions = createPostgresV2Actions(db as never)

    await actions.nightContact(postBody({ shipId: 1, contact: true }))

    expect(insert).toHaveBeenCalledWith(nightContacts)
    expect(insertChain.valuesArg).not.toHaveProperty('origin')
  })

  test('nightBattleCi maps uppercase CI to lowercase ci and preserves fractional damage/time', async () => {
    const { db, insert, insertChain } = createFakeDb()
    const actions = createPostgresV2Actions(db as never)

    await actions.nightBattleCi(
      postBody({
        shipId: 1,
        CI: 'oneMoreYasen',
        damage: [12.5, 7.25],
        damageTotal: 19.75,
        time: 1700000000123,
      }),
    )

    expect(insert).toHaveBeenCalledWith(nightBattleCis)
    expect(insertChain.valuesArg).toMatchObject({
      ci: 'oneMoreYasen',
      damage: [12.5, 7.25],
      damageTotal: 19.75,
      time: 1700000000123,
    })
    expect(insertChain.valuesArg).not.toHaveProperty('CI')
  })
})

describe('createPostgresV2Actions: dropShip', () => {
  test('clears ownedShipSnapshot for mapId < 73', async () => {
    const { db, insert, insertChain } = createFakeDb()
    const actions = createPostgresV2Actions(db as never)

    await actions.dropShip(postBody({ mapId: 72, ownedShipSnapshot: { 1: [100] } }))

    expect(insert).toHaveBeenCalledWith(dropShipRecords)
    expect(insertChain.valuesArg).toMatchObject({ ownedShipSnapshot: {} })
  })

  test('preserves ownedShipSnapshot for mapId >= 73', async () => {
    const { insertChain, db } = createFakeDb()
    const actions = createPostgresV2Actions(db as never)

    await actions.dropShip(postBody({ mapId: 73, ownedShipSnapshot: { 1: [100] } }))

    expect(insertChain.valuesArg).toMatchObject({ ownedShipSnapshot: { 1: [100] } })
  })

  test('treats an absent mapId as not late (does not clear the snapshot)', async () => {
    const { insertChain, db } = createFakeDb()
    const actions = createPostgresV2Actions(db as never)

    await actions.dropShip(postBody({ ownedShipSnapshot: { 1: [100] } }))

    expect(insertChain.valuesArg).toMatchObject({ ownedShipSnapshot: { 1: [100] } })
  })

  test('treats an explicit null mapId as early (clears the snapshot)', async () => {
    const { insertChain, db } = createFakeDb()
    const actions = createPostgresV2Actions(db as never)

    await actions.dropShip(postBody({ mapId: null, ownedShipSnapshot: { 1: [100] } }))

    expect(insertChain.valuesArg).toMatchObject({ ownedShipSnapshot: {} })
  })
})

describe('createPostgresV2Actions: selectRank', () => {
  test('atomically upserts by (teitokuId, mapareaId), replacing nullable values', async () => {
    const { db, insert, insertChain } = createFakeDb()
    const actions = createPostgresV2Actions(db as never)

    const result = await actions.selectRank(
      postBody({ teitokuId: 'admiral-1', teitokuLv: 120, mapareaId: 5, rank: 3 }),
    )

    expect(result.status).toBe(200)
    expect(insert).toHaveBeenCalledWith(selectRankRecords)
    expect(insertChain.valuesArg).toEqual({
      teitokuId: 'admiral-1',
      mapareaId: 5,
      teitokuLv: 120,
      rank: 3,
      origin: '',
    })
    expect(insertChain.onConflictArg).toEqual({
      target: [selectRankRecords.teitokuId, selectRankRecords.mapareaId],
      set: { teitokuLv: 120, rank: 3, origin: '' },
    })
  })

  test('replaces stored values with explicit nulls', async () => {
    const { db, insertChain } = createFakeDb()
    const actions = createPostgresV2Actions(db as never)

    await actions.selectRank(
      postBody({ teitokuId: 'admiral-1', teitokuLv: null, mapareaId: 5, rank: null }),
    )

    expect(insertChain.onConflictArg).toMatchObject({ set: { teitokuLv: null, rank: null } })
  })

  test('returns 400 when a Domain Identity field is missing', async () => {
    const { db, insert } = createFakeDb()
    const actions = createPostgresV2Actions(db as never)

    const result = await actions.selectRank(postBody({ teitokuLv: 120 }))

    expect(result.status).toBe(400)
    expect(insert).not.toHaveBeenCalled()
  })
})

describe('createPostgresV2Actions: remodelRecipe', () => {
  const identityPayload = {
    recipeId: 33,
    itemId: 700,
    stage: 1,
    day: 6,
    secretary: 100,
  }

  test('is a no-op for stage -1', async () => {
    const { db, insert } = createFakeDb()
    const actions = createPostgresV2Actions(db as never)

    const result = await actions.remodelRecipe(postBody({ ...identityPayload, stage: -1 }))

    expect(result).toEqual({ body: undefined, status: 200 })
    expect(insert).not.toHaveBeenCalled()
  })

  test('atomically upserts, incrementing count and setting last_reported from database time', async () => {
    const { db, insert, insertChain } = createFakeDb()
    const actions = createPostgresV2Actions(db as never)

    await actions.remodelRecipe(postBody({ ...identityPayload, fuel: 10, key: 'k' }))

    expect(insert).toHaveBeenCalledWith(recipeRecords)
    const valuesArg = insertChain.valuesArg as Record<string, unknown>
    expect(valuesArg).toMatchObject({ ...identityPayload, fuel: 10, key: 'k' })
    expect(is(valuesArg.lastReported, SQL)).toBe(true)

    expect(insertChain.onConflictArg).toMatchObject({
      target: [
        recipeRecords.recipeId,
        recipeRecords.itemId,
        recipeRecords.stage,
        recipeRecords.day,
        recipeRecords.secretary,
      ],
    })
    const setArg = (insertChain.onConflictArg as { set: Record<string, unknown> }).set
    expect(setArg).toEqual({
      count: sql`${recipeRecords.count} + 1`,
      lastReported: valuesArg.lastReported,
      fuel: 10,
      key: 'k',
      origin: '',
    })
  })

  test('a missing non-identity field does not erase the stored value; explicit null does', async () => {
    const { db, insertChain } = createFakeDb()
    const actions = createPostgresV2Actions(db as never)

    await actions.remodelRecipe(postBody({ ...identityPayload, fuel: null }))

    const setArg = (insertChain.onConflictArg as { set: Record<string, unknown> }).set
    expect(setArg).toHaveProperty('fuel', null)
    expect(setArg).not.toHaveProperty('ammo')
  })
})

describe('createPostgresV2Actions: shipStat', () => {
  test('maps payload id/los_max/etc. to ship_id/los_max columns and atomically upserts', async () => {
    const { db, insert, insertChain } = createFakeDb()
    const actions = createPostgresV2Actions(db as never)

    const result = await actions.shipStat(
      postBody({
        id: 100,
        lv: 99,
        los: 80,
        los_max: 90,
        asw: 70,
        asw_max: 80,
        evasion: 100,
        evasion_max: 110,
      }),
    )

    expect(result.status).toBe(200)
    expect(insert).toHaveBeenCalledWith(shipStats)
    const valuesArg = insertChain.valuesArg as Record<string, unknown>
    expect(valuesArg).toMatchObject({
      shipId: 100,
      lv: 99,
      los: 80,
      losMax: 90,
      asw: 70,
      aswMax: 80,
      evasion: 100,
      evasionMax: 110,
    })
    expect(insertChain.onConflictArg).toMatchObject({
      target: [
        shipStats.shipId,
        shipStats.lv,
        shipStats.los,
        shipStats.losMax,
        shipStats.asw,
        shipStats.aswMax,
        shipStats.evasion,
        shipStats.evasionMax,
      ],
    })
    const setArg = (insertChain.onConflictArg as { set: Record<string, unknown> }).set
    expect(setArg).toEqual({
      count: sql`${shipStats.count} + 1`,
      lastTimestamp: valuesArg.lastTimestamp,
    })
    expect(is(setArg.lastTimestamp, SQL)).toBe(true)
  })
})

describe('createPostgresV2Actions: enemyInfo', () => {
  const enemyPayload = {
    ships1: [1, 2],
    levels1: [1, 1],
    hp1: [10, 10],
    stats1: [[1], [2]],
    equips1: [[3], [4]],
    ships2: [] as number[],
    levels2: [] as number[],
    hp2: [] as number[],
    stats2: [] as number[][],
    equips2: [] as number[][],
    planes: 10,
  }

  const identityHashFor = (payload: typeof enemyPayload) => computeEnemyInfoIdentityHash(payload)

  test('inserts with the SHA-256 identity hash and increments count on conflict', async () => {
    const returningRows = [{ ...enemyPayload }]
    const { db, insert, insertChain } = createFakeDb({ returningRows })
    const actions = createPostgresV2Actions(db as never)

    const result = await actions.enemyInfo(
      postBody({ ...enemyPayload, bombersMin: 5, bombersMax: 10 }),
    )

    expect(result.status).toBe(200)
    expect(insert).toHaveBeenCalledWith(enemyInfos)
    const valuesArg = insertChain.valuesArg as Record<string, unknown>
    expect(valuesArg.identityHash).toEqual(identityHashFor(enemyPayload))
    expect(valuesArg).toMatchObject({ ...enemyPayload, bombersMin: 5, bombersMax: 10 })
    expect(insertChain.onConflictArg).toMatchObject({ target: enemyInfos.identityHash })
    expect(insertChain.onConflictArg).toHaveProperty('setWhere')
  })

  test('numeric bombersMin applies greatest and numeric bombersMax applies least', async () => {
    const returningRows = [{ ...enemyPayload }]
    const { db, insertChain } = createFakeDb({ returningRows })
    const actions = createPostgresV2Actions(db as never)

    await actions.enemyInfo(postBody({ ...enemyPayload, bombersMin: 7, bombersMax: 8 }))

    const setArg = (insertChain.onConflictArg as { set: Record<string, unknown> }).set
    expect(setArg.bombersMin).toEqual(sql`greatest(${enemyInfos.bombersMin}, ${7})`)
    expect(setArg.bombersMax).toEqual(sql`least(${enemyInfos.bombersMax}, ${8})`)
  })

  test('an absent bomber field leaves the stored bound unchanged', async () => {
    const returningRows = [{ ...enemyPayload }]
    const { db, insertChain } = createFakeDb({ returningRows })
    const actions = createPostgresV2Actions(db as never)

    await actions.enemyInfo(postBody({ ...enemyPayload }))

    const setArg = (insertChain.onConflictArg as { set: Record<string, unknown> }).set
    expect(setArg).not.toHaveProperty('bombersMin')
    expect(setArg).not.toHaveProperty('bombersMax')
  })

  test('explicit null bombersMin leaves an existing numeric minimum unchanged', async () => {
    const returningRows = [{ ...enemyPayload }]
    const { db, insertChain } = createFakeDb({ returningRows })
    const actions = createPostgresV2Actions(db as never)

    await actions.enemyInfo(postBody({ ...enemyPayload, bombersMin: null }))

    const setArg = (insertChain.onConflictArg as { set: Record<string, unknown> }).set
    expect(setArg).not.toHaveProperty('bombersMin')
  })

  test('explicit null bombersMax replaces an existing numeric maximum with null', async () => {
    const returningRows = [{ ...enemyPayload }]
    const { db, insertChain } = createFakeDb({ returningRows })
    const actions = createPostgresV2Actions(db as never)

    await actions.enemyInfo(postBody({ ...enemyPayload, bombersMax: null }))

    const setArg = (insertChain.onConflictArg as { set: Record<string, unknown> }).set
    expect(setArg).toHaveProperty('bombersMax', null)
  })

  test('returns 500 and captures an exception when the returned row mismatches the incoming identity (hash collision)', async () => {
    const returningRows = [{ ...enemyPayload, planes: 999 }]
    const { db } = createFakeDb({ returningRows })
    const actions = createPostgresV2Actions(db as never)

    const result = await actions.enemyInfo(postBody({ ...enemyPayload }))

    expect(result.status).toBe(500)
    expect(captureExceptionMock).toHaveBeenCalled()
  })
})

describe('createPostgresV2Actions: aaci', () => {
  test('persists only when the shared AACI gate passes', async () => {
    const { db, insert } = createFakeDb()
    const actions = createPostgresV2Actions(db as never)

    const eligible = await actions.aaci(
      postBody({ poiVersion: '7.9.2' }, { 'x-reporter': 'Reporter 3.6.0' }),
    )

    expect(eligible.status).toBe(200)
    expect(insert).toHaveBeenCalledWith(aaciRecords)
  })

  test('does not persist and still returns 200 when the gate fails', async () => {
    const { db, insert } = createFakeDb()
    const actions = createPostgresV2Actions(db as never)

    const result = await actions.aaci(
      postBody({ poiVersion: '7.9.1' }, { 'x-reporter': 'Reporter 3.6.0' }),
    )

    expect(result.status).toBe(200)
    expect(insert).not.toHaveBeenCalled()
  })

  test('returns a logged 400 for an invalid poiVersion', async () => {
    const { db, insert } = createFakeDb()
    const actions = createPostgresV2Actions(db as never)

    const result = await actions.aaci(postBody({ poiVersion: 'not-semver' }))

    expect(result.status).toBe(400)
    expect(insert).not.toHaveBeenCalled()
  })
})

describe('createPostgresV2Actions: known_quests, no-ops, and error handling', () => {
  test('returns distinct quest ids sorted with JavaScript default (lexicographic) sort', async () => {
    const { db } = createFakeDb({
      selectDistinctRows: [{ questId: 2 }, { questId: 10 }, { questId: 1 }],
    })
    const actions = createPostgresV2Actions(db as never)

    const result = await actions.knownQuests(createRequest({ method: 'GET' }))

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ quests: [1, 10, 2] })
  })

  test('known_quests applies Cloudflare cache headers', async () => {
    const { db } = createFakeDb({ selectDistinctRows: [] })
    const actions = createPostgresV2Actions(db as never)

    const result = await actions.knownQuests(createRequest({ method: 'GET' }))

    expect(result.headers).toMatchObject({ 'Cache-Control': 'public, max-age=60' })
  })

  test('knownRecipes, questNoop, remodelRecipeDeduplicate, and nightBattleSsCi are no-ops', async () => {
    const { db, insert, selectDistinct } = createFakeDb()
    const actions = createPostgresV2Actions(db as never)

    expect(await actions.knownRecipes()).toEqual({ body: { recipes: [] }, status: 200 })
    expect(await actions.questNoop()).toEqual({ body: undefined, status: 200 })
    expect(await actions.remodelRecipeDeduplicate(createRequest())).toEqual({
      body: { recipes: [] },
      status: 200,
    })
    expect(await actions.nightBattleSsCi()).toEqual({ body: undefined, status: 200 })
    expect(insert).not.toHaveBeenCalled()
    expect(selectDistinct).not.toHaveBeenCalled()
  })

  test('malformed JSON returns a 400 without touching the database', async () => {
    const { db, insert } = createFakeDb()
    const actions = createPostgresV2Actions(db as never)

    const result = await actions.createShip(createRequest({ body: { data: '{' } }))

    expect(result).toEqual({ body: { error: 'data must be valid JSON' }, status: 400 })
    expect(insert).not.toHaveBeenCalled()
  })

  test('a database error is captured and returns 500', async () => {
    const insert = vi.fn(() => {
      throw new Error('connection lost')
    })
    const actions = createPostgresV2Actions({ insert } as never)

    const result = await actions.createShip(postBody({}))

    expect(result).toEqual({ status: 500 })
    expect(captureExceptionMock).toHaveBeenCalled()
  })
})
