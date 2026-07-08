import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { sql } from 'drizzle-orm'

const postgresUrl = process.env.POI_TEST_POSTGRES_URL
const describePostgres = postgresUrl ? describe : describe.skip

describePostgres('PostgreSQL schema and action semantics', () => {
  const loadPostgresModule = () => import('../src/db/postgres')
  const loadSchemaModule = () => import('../src/db/schema/postgres')
  const loadV2Actions = () => import('../src/controllers/api/report/v2.postgres.actions')
  const loadV3Actions = () => import('../src/controllers/api/report/v3.postgres.actions')

  let closePostgresDb: Awaited<ReturnType<typeof loadPostgresModule>>['closePostgresDb']
  let getPostgresDb: Awaited<ReturnType<typeof loadPostgresModule>>['getPostgresDb']
  let runPostgresMigrations: Awaited<ReturnType<typeof loadPostgresModule>>['runPostgresMigrations']
  let schema: Awaited<ReturnType<typeof loadSchemaModule>>
  let v2Actions: Awaited<ReturnType<typeof loadV2Actions>>
  let v3Actions: Awaited<ReturnType<typeof loadV3Actions>>

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

  beforeAll(async () => {
    process.env.POI_SERVER_DATABASE_URL = postgresUrl
    delete process.env.POI_SERVER_DB
    vi.resetModules()

    ;({ closePostgresDb, getPostgresDb, runPostgresMigrations } = await loadPostgresModule())
    schema = await loadSchemaModule()
    v2Actions = await loadV2Actions()
    v3Actions = await loadV3Actions()

    await closePostgresDb()
    await runPostgresMigrations(postgresUrl as string)
  })

  beforeEach(async () => {
    await getPostgresDb(postgresUrl as string).execute(truncateSql)
  })

  afterAll(async () => {
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
})
