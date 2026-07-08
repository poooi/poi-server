import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { sql } from 'drizzle-orm'

const postgresUrl = process.env.POI_TEST_POSTGRES_URL
const describePostgres = postgresUrl ? describe : describe.skip

describePostgres('PostgreSQL schema and action semantics', () => {
  const loadPostgresModule = () => import('../src/db/postgres')
  const loadSchemaModule = () => import('../src/db/schema/postgres')
  const loadV2Actions = () => import('../src/controllers/api/report/v2.postgres.actions')
  const loadV3Actions = () => import('../src/controllers/api/report/v3.postgres.actions')
  const loadSharedModule = () => import('../src/controllers/api/report/v3.item-improvement.shared')

  let closePostgresDb: Awaited<ReturnType<typeof loadPostgresModule>>['closePostgresDb']
  let getPostgresDb: Awaited<ReturnType<typeof loadPostgresModule>>['getPostgresDb']
  let runPostgresMigrations: Awaited<ReturnType<typeof loadPostgresModule>>['runPostgresMigrations']
  let schema: Awaited<ReturnType<typeof loadSchemaModule>>
  let v2Actions: Awaited<ReturnType<typeof loadV2Actions>>
  let v3Actions: Awaited<ReturnType<typeof loadV3Actions>>
  let shared: Awaited<ReturnType<typeof loadSharedModule>>
  let now = Date.UTC(2026, 6, 3, 15, 0, 5)

  const reporterOrigin = 'Reporter/8.1.0 poi/10.3.99'
  const observedAt = Date.UTC(2026, 6, 3, 15)

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

  const createRequest = (
    body: unknown,
    headers: Record<string, string> = { 'x-reporter': reporterOrigin },
    query: Record<string, string | undefined> = {},
  ) => ({
    body: { data: body },
    headers,
    method: 'POST',
    params: {},
    path: '',
    query,
    url: '',
  })

  const baseListRecord = (overrides: Record<string, unknown> = {}) => ({
    schemaVersion: 1,
    source: 'list' as const,
    clientObservedAt: observedAt,
    recipeId: 33,
    itemId: 700,
    day: 6,
    observedSecondShipId: 0,
    observedFlagshipId: 101,
    ...overrides,
  })

  const baseDetailRecord = (overrides: Record<string, unknown> = {}) => ({
    schemaVersion: 1,
    source: 'detail' as const,
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
    ...overrides,
  })

  const baseExecutionRecord = (overrides: Record<string, unknown> = {}) => ({
    schemaVersion: 1,
    source: 'execution' as const,
    clientObservedAt: observedAt,
    recipeId: 33,
    itemId: 700,
    itemLevel: 10,
    day: 6,
    observedSecondShipId: 102,
    observedFlagshipId: 101,
    upgradeObserved: true as const,
    upgradeToItemId: 701,
    upgradeToItemLevel: 0,
    ...overrides,
  })

  const seedAvailabilityFact = (
    recipeId: number,
    values: Partial<typeof schema.itemImprovementAvailabilityFacts.$inferInsert> = {},
  ) => ({
    key: `v1|availability|${recipeId}|700|6|0`,
    schemaVersion: 1,
    recipeId,
    itemId: 700,
    day: 6,
    firstClientObservedAt: observedAt,
    lastClientObservedAt: observedAt,
    observedSecondShipId: 0,
    observedFlagshipIds: [101],
    sources: ['list'],
    origins: [reporterOrigin],
    firstReported: observedAt,
    lastReported: observedAt,
    count: 1,
    rawPayload: { recipeId },
    ...values,
  })

  beforeAll(async () => {
    process.env.POI_SERVER_DATABASE_URL = postgresUrl
    delete process.env.POI_SERVER_DB
    vi.resetModules()

    ;({ closePostgresDb, getPostgresDb, runPostgresMigrations } = await loadPostgresModule())
    schema = await loadSchemaModule()
    v2Actions = await loadV2Actions()
    v3Actions = await loadV3Actions()
    shared = await loadSharedModule()

    await closePostgresDb()
    await runPostgresMigrations(postgresUrl as string)
  })

  beforeEach(async () => {
    now = Date.UTC(2026, 6, 3, 15, 0, 5)
    vi.restoreAllMocks()
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    await getPostgresDb(postgresUrl as string).execute(truncateSql)
  })

  afterAll(async () => {
    vi.restoreAllMocks()
    await closePostgresDb()
  })

  test('stores raw payload extensions and returns bigint columns as numbers', async () => {
    await v2Actions.createShip({
      items: [30, 30, 30, 30],
      kdockId: 1,
      secretary: 100,
      shipId: 101,
      highspeed: 0,
      teitokuLv: 120,
      largeFlag: false,
      origin: 'Reporter 3.6.0',
      futureField: { nested: true },
    })

    await v2Actions.nightBattleCi({
      shipId: 1,
      CI: 'Cut-In',
      type: 'surface',
      lv: 99,
      rawLuck: 20,
      pos: 1,
      status: 'healthy',
      items: [1, 2],
      improvement: [0, 0],
      searchLight: false,
      flare: 0,
      defenseId: 10,
      defenseTypeId: 20,
      ciType: 30,
      display: [1, 1],
      hitType: [1, 2],
      damage: [10, 20],
      damageTotal: 30,
      time: 1720450000123,
      origin: 'Reporter 3.6.0',
      anotherFutureField: 'preserved',
    })

    const [shipRecord] = await getPostgresDb(postgresUrl as string)
      .select()
      .from(schema.createShipRecords)
    const [nightBattleRecord] = await getPostgresDb(postgresUrl as string)
      .select()
      .from(schema.nightBattleCis)

    expect(shipRecord.rawPayload).toMatchObject({
      futureField: { nested: true },
    })
    expect(nightBattleRecord.rawPayload).toMatchObject({ anotherFutureField: 'preserved' })
    expect(typeof nightBattleRecord.time).toBe('number')
    expect(nightBattleRecord.time).toBe(1720450000123)
  })

  test('select rank upserts by admiral and map area', async () => {
    await v2Actions.selectRank({
      teitokuId: 'admiral-1',
      teitokuLv: 100,
      mapareaId: 6,
      rank: 1,
      origin: 'Reporter 3.6.0',
    })
    await v2Actions.selectRank({
      teitokuId: 'admiral-1',
      teitokuLv: 101,
      mapareaId: 6,
      rank: 2,
      origin: 'Reporter 3.7.0',
    })

    const records = await getPostgresDb(postgresUrl as string)
      .select()
      .from(schema.selectRankRecords)

    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ teitokuLv: 101, rank: 2, origin: 'Reporter 3.7.0' })
  })

  test('remodel recipe upsert increments count and ignores stage -1', async () => {
    const recipe = {
      recipeId: 33,
      itemId: 700,
      stage: 1,
      day: 2,
      secretary: 182,
      fuel: 10,
      ammo: 20,
      steel: 30,
      bauxite: 40,
      reqItemId: 65,
      reqItemCount: 1,
      buildkit: 2,
      remodelkit: 3,
      certainBuildkit: 4,
      certainRemodelkit: 5,
      upgradeToItemId: 701,
      upgradeToItemLevel: 0,
      key: 'recipe-key',
      origin: 'Reporter 3.6.0',
    }

    await v2Actions.remodelRecipe(recipe)
    await v2Actions.remodelRecipe({ ...recipe, origin: 'Reporter 3.7.0' })
    await v2Actions.remodelRecipe({ ...recipe, stage: -1, key: 'ignored' })

    const records = await getPostgresDb(postgresUrl as string)
      .select()
      .from(schema.recipeRecords)

    expect(records).toHaveLength(1)
    expect(records[0].count).toBe(2)
    expect(typeof records[0].lastReported).toBe('number')
  })

  test('ship stat upsert increments count and preserves numeric bigint timestamps', async () => {
    const stat = {
      id: 144,
      lv: 80,
      los: 50,
      los_max: 80,
      asw: 40,
      asw_max: 70,
      evasion: 60,
      evasion_max: 90,
    }

    await v2Actions.shipStat(stat)
    await v2Actions.shipStat(stat)

    const records = await getPostgresDb(postgresUrl as string)
      .select()
      .from(schema.shipStats)

    expect(records).toHaveLength(1)
    expect(records[0].count).toBe(2)
    expect(typeof records[0].lastTimestamp).toBe('number')
  })

  test('enemy info upsert intersects bomber range and increments count', async () => {
    const enemy = {
      ships1: [1, 2],
      levels1: [3, 4],
      hp1: [5, 6],
      stats1: [
        [1, 1],
        [2, 2],
      ],
      equips1: [[10], [11]],
      ships2: [7],
      levels2: [8],
      hp2: [9],
      stats2: [[3, 3]],
      equips2: [[12]],
      planes: 40,
    }

    await v2Actions.enemyInfo({ ...enemy, bombersMin: 2, bombersMax: 9 })
    await v2Actions.enemyInfo({ ...enemy, bombersMin: 4, bombersMax: 7 })

    const records = await getPostgresDb(postgresUrl as string)
      .select()
      .from(schema.enemyInfos)

    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ bombersMin: 4, bombersMax: 7, count: 2 })
  })

  test('quest reward uses array equality key and maps legacy bounsCount to bonus_count', async () => {
    const payload = {
      questId: 214,
      title: 'Quest title',
      detail: 'Quest detail',
      category: 2,
      type: 1,
      origin: 'Reporter 3.6.0',
      selections: [1] as [number],
      material: [100] as [number],
      bonus: [{ type: 'item', id: 1 }],
      bounsCount: 1,
    }

    await v3Actions.questReward(payload)
    await v3Actions.questReward(payload)
    await v3Actions.questReward({ ...payload, bounsCount: 2 })

    const records = await getPostgresDb(postgresUrl as string)
      .select()
      .from(schema.questRewards)
      .orderBy(schema.questRewards.bonusCount)

    expect(records).toHaveLength(2)
    expect(records.map((record) => record.bonusCount)).toEqual([1, 2])
    expect(records[0].selections).toEqual([1])
  })

  test('builds deterministic keys for availability, cost, and update facts', () => {
    expect(shared.createAvailabilityKey({ ...baseListRecord(), observedFlagshipIds: [101] })).toBe(
      'v1|availability|33|700|6|0',
    )
    expect(shared.createCostKey({ ...baseDetailRecord(), observedFlagshipIds: [101] })).toBe(
      'v1|cost|33|700|6|1|6|0|10|20|30|40|3|4|5|6|90:2|65:1|0',
    )
    expect(shared.createUpdateKey({ ...baseExecutionRecord(), observedFlagshipIds: [101] })).toBe(
      'v1|update|33|700|10|6|102|701|0',
    )
  })

  test('upserts repeated ingests with min/max/count and set-union semantics', async () => {
    await v3Actions.itemImprovementRecipe(
      createRequest({
        records: [
          baseListRecord(),
          baseDetailRecord({ clientObservedAt: observedAt + 5_000 }),
          baseExecutionRecord(),
        ],
      }),
    )

    now += 1_000
    await v3Actions.itemImprovementRecipe(
      createRequest(
        {
          records: [
            baseListRecord({
              clientObservedAt: observedAt + 5_000,
              observedFlagshipIds: [101, 103],
            }),
            baseDetailRecord({
              clientObservedAt: observedAt + 1_000,
              observedFlagshipIds: [101, 104],
              futureField: 'preserved',
            }),
            baseExecutionRecord({ clientObservedAt: observedAt + 10_000, observedFlagshipId: 105 }),
          ],
        },
        { 'x-reporter': 'Reporter/8.2.0 poi/10.3.99' },
      ),
    )

    const db = getPostgresDb(postgresUrl as string)
    const [availability] = await db.select().from(schema.itemImprovementAvailabilityFacts)
    const [cost] = await db.select().from(schema.itemImprovementCostFacts)
    const [update] = await db.select().from(schema.itemImprovementUpdateFacts)

    expect(availability.count).toBe(2)
    expect(availability.firstClientObservedAt).toBe(observedAt)
    expect(availability.lastClientObservedAt).toBe(observedAt + 5_000)
    expect(availability.firstReported).toBe(now - 1_000)
    expect(availability.lastReported).toBe(now)
    expect(availability.sources).toEqual(['list'])
    expect(availability.origins).toEqual([reporterOrigin, 'Reporter/8.2.0 poi/10.3.99'])
    expect(availability.observedFlagshipIds).toEqual([101, 103])

    expect(cost.count).toBe(2)
    expect(cost.firstClientObservedAt).toBe(observedAt + 1_000)
    expect(cost.lastClientObservedAt).toBe(observedAt + 5_000)
    expect(cost.origins).toEqual([reporterOrigin, 'Reporter/8.2.0 poi/10.3.99'])
    expect(cost.observedFlagshipIds).toEqual([101, 104])
    expect(cost.rawPayload).toMatchObject({ futureField: 'preserved' })

    expect(update.count).toBe(2)
    expect(update.firstClientObservedAt).toBe(observedAt)
    expect(update.lastClientObservedAt).toBe(observedAt + 10_000)
    expect(update.origins).toEqual([reporterOrigin, 'Reporter/8.2.0 poi/10.3.99'])
    expect(update.observedFlagshipIds).toEqual([101, 105])
  })

  test('exports default 500 records and clamps over-max limits to 1000', async () => {
    const db = getPostgresDb(postgresUrl as string)
    const seeded = Array.from({ length: 1005 }, (_, index) =>
      seedAvailabilityFact(index + 1, {
        recipeId: index + 1,
        key: `v1|availability|${index + 1}|700|6|0`,
        firstReported: observedAt + index,
        lastReported: observedAt + index,
        rawPayload: { recipeId: index + 1 },
      }),
    )
    await db.insert(schema.itemImprovementAvailabilityFacts).values(seeded)

    now = observedAt + 10_000
    const defaultPage = await v3Actions.itemImprovementRecipeAvailability(createRequest({}, {}, {}))
    const clampedPage = await v3Actions.itemImprovementRecipeAvailability(
      createRequest({}, {}, { updatedAfter: '0', limit: '5000' }),
    )

    expect(defaultPage.records).toHaveLength(500)
    expect(defaultPage.next).toEqual({
      updatedAfter: defaultPage.records[499].lastReported,
      afterId: defaultPage.records[499]._id,
    })
    expect(clampedPage.records).toHaveLength(1000)
  })

  test('exports ordered records with numeric timestamps, no origins, and correct cursors across pages', async () => {
    now = observedAt
    await v3Actions.itemImprovementRecipe(
      createRequest({
        records: [
          baseListRecord({ recipeId: 33, itemId: 700 }),
          baseListRecord({ recipeId: 34, itemId: 701 }),
          baseListRecord({ recipeId: 35, itemId: 702 }),
        ],
      }),
    )

    now = observedAt + 5_000
    const firstPage = await v3Actions.itemImprovementRecipeAvailability(
      createRequest({}, {}, { updatedAfter: '0', limit: '2' }),
    )
    const secondPage = await v3Actions.itemImprovementRecipeAvailability(
      createRequest(
        {},
        {},
        {
          updatedAfter: String(firstPage.next?.updatedAfter),
          afterId: firstPage.next?.afterId,
          limit: '2',
        },
      ),
    )

    expect(firstPage.records).toHaveLength(2)
    expect(secondPage.records).toHaveLength(1)
    expect(firstPage.records[0]._id < firstPage.records[1]._id).toBe(true)
    expect(typeof firstPage.records[0].lastReported).toBe('number')
    expect(typeof firstPage.records[0].firstClientObservedAt).toBe('number')
    expect(firstPage.records[0]).toHaveProperty('_id')
    expect(firstPage.records[0]).not.toHaveProperty('origins')
    expect(firstPage.records[0]).not.toHaveProperty('rawPayload')
    expect(firstPage.records[0]).not.toHaveProperty('exportId')
    expect(
      [...firstPage.records, ...secondPage.records].map((record) => record.key).sort(),
    ).toEqual([
      'v1|availability|33|700|6|0',
      'v1|availability|34|701|6|0',
      'v1|availability|35|702|6|0',
    ])
    expect(secondPage.next).toEqual({
      updatedAfter: secondPage.records[0].lastReported,
      afterId: secondPage.records[0]._id,
    })
  })

  test('uses a settled export window and same-timestamp afterId pagination without skips', async () => {
    const db = getPostgresDb(postgresUrl as string)
    const sameTimestamp = observedAt

    await db.insert(schema.itemImprovementAvailabilityFacts).values([
      seedAvailabilityFact(34, {
        exportSequence: 2,
        recipeId: 34,
        key: 'v1|availability|34|700|6|0',
        firstReported: sameTimestamp,
        lastReported: sameTimestamp,
      }),
      seedAvailabilityFact(33, {
        exportSequence: 1,
        recipeId: 33,
        key: 'v1|availability|33|700|6|0',
        firstReported: sameTimestamp,
        lastReported: sameTimestamp,
      }),
    ])

    now = sameTimestamp + 1_000
    const unsettledPage = await v3Actions.itemImprovementRecipeAvailability(
      createRequest({}, {}, { updatedAfter: '0', limit: '1' }),
    )
    expect(unsettledPage).toEqual({ records: [], next: null })

    now = sameTimestamp + 5_000
    const firstPage = await v3Actions.itemImprovementRecipeAvailability(
      createRequest({}, {}, { updatedAfter: '0', limit: '1' }),
    )
    const secondPage = await v3Actions.itemImprovementRecipeAvailability(
      createRequest(
        {},
        {},
        {
          updatedAfter: String(firstPage.next?.updatedAfter),
          afterId: firstPage.next?.afterId,
          limit: '1',
        },
      ),
    )

    expect(firstPage.records[0]._id).toBe('000000000000000000000001')
    expect(secondPage.records[0]._id).toBe('000000000000000000000002')
    expect([...firstPage.records, ...secondPage.records].map((record) => record.key)).toEqual([
      'v1|availability|33|700|6|0',
      'v1|availability|34|700|6|0',
    ])
  })

  test('stores raw_payload future fields without leaking them in exports', async () => {
    now = observedAt
    await v3Actions.itemImprovementRecipe(
      createRequest({
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
        futureField: { nested: true },
      }),
    )

    const [cost] = await getPostgresDb(postgresUrl as string)
      .select()
      .from(schema.itemImprovementCostFacts)
    now = observedAt + 5_000
    const exported = await v3Actions.itemImprovementRecipeCosts(createRequest({}, {}, {}))

    expect(cost.rawPayload).toMatchObject({ futureField: { nested: true } })
    expect(exported.records[0]).not.toHaveProperty('futureField')
    expect(exported.records[0]).not.toHaveProperty('rawPayload')
  })

  test('matches Mongo validation errors for oversized batches, invalid cursors, and malformed required items', async () => {
    const oversizedBatch = createRequest({
      records: Array.from({ length: 101 }, () => baseListRecord()),
    })
    const invalidCursor = createRequest({}, {}, { afterId: 'invalid-object-id' })
    const malformedRequiredItems = createRequest({
      ...baseDetailRecord(),
      reqUseItems: [{ id: 65, count: 0 }],
    })

    await expect(v3Actions.itemImprovementRecipe(oversizedBatch)).rejects.toSatisfy(
      (err) =>
        v3Actions.isItemImprovementValidationError(err) &&
        v3Actions.getItemImprovementRecipeValidationErrorMessage(err) ===
          'records: Too big: expected array to have <=100 items',
    )
    await expect(v3Actions.itemImprovementRecipeAvailability(invalidCursor)).rejects.toSatisfy(
      (err) =>
        v3Actions.isItemImprovementValidationError(err) &&
        v3Actions.getItemImprovementRecipeValidationErrorMessage(err) ===
          'afterId: must be a valid ObjectId',
    )
    await expect(v3Actions.itemImprovementRecipe(malformedRequiredItems)).rejects.toSatisfy(
      (err) =>
        v3Actions.isItemImprovementValidationError(err) &&
        v3Actions.getItemImprovementRecipeValidationErrorMessage(err) ===
          'reqUseItems.0: must contain positive id and count',
    )
  })
})
