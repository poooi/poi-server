import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import mongoose from 'mongoose'
import {
  ItemImprovementRecipeAvailabilityFact,
  ItemImprovementRecipeCostFact,
  ItemImprovementRecipeUpdateFact,
  Quest,
} from '../src/models'
import { createShip } from '../src/controllers/api/report/v2.mongo.actions'
import {
  itemImprovementRecipe,
  itemImprovementRecipeAvailability,
  quest,
} from '../src/controllers/api/report/v3.mongo.actions'
import { type AppRequest } from '../src/http/request'
import { type AppResult } from '../src/http/result'

const reporterOrigin = 'Reporter/8.1.0 poi/10.3.99'
const observedAt = Date.UTC(2026, 6, 3, 15)
const receivedAt = observedAt

const v2Router = 'v2'
const v3Router = 'v3'

type PostHandler = (request: AppRequest) => Promise<AppResult>

const getPostHandler = (router: string, path: string): PostHandler => {
  const handlers: Record<string, PostHandler> = {
    'v2:/create_ship': createShip,
    'v3:/item_improvement_recipe': itemImprovementRecipe,
    'v3:/quest': quest,
  }
  const handler = handlers[`${router}:${path}`]
  if (handler == null) {
    throw new Error(`${router} ${path} route is not registered`)
  }
  return handler
}

const createRequest = (
  body: unknown,
  headers: Record<string, string>,
  query: Record<string, string | undefined> = {},
): AppRequest => ({
  body,
  headers,
  log: { warn: vi.fn() },
  method: 'POST',
  params: {},
  path: '',
  query,
  url: '',
})

const invokeReportPost = async (router: string, path: string, data: unknown) => {
  const headers: Record<string, string> = {
    'x-reporter': reporterOrigin,
  }

  return getPostHandler(router, path)(createRequest({ data }, headers))
}

const invokeItemImprovementRecipePost = async (data: unknown) => {
  const headers: Record<string, string> = {
    'x-reporter': reporterOrigin,
  }

  return itemImprovementRecipe(createRequest({ data }, headers))
}

const invokeAvailabilityExport = async (query: Record<string, string | undefined>) => {
  const params = new URLSearchParams()
  Object.entries(query).forEach(([key, value]) => {
    if (value != null) {
      params.set(key, value)
    }
  })
  const path = '/item_improvement_recipes/availability'
  const queryString = params.toString()

  return itemImprovementRecipeAvailability({
    body: { data: {} },
    headers: {},
    log: { warn: vi.fn() },
    method: 'GET',
    params: {},
    path,
    query,
    url: queryString === '' ? path : `${path}?${queryString}`,
  })
}

interface FakeFindChain {
  select: ReturnType<typeof vi.fn>
  sort: ReturnType<typeof vi.fn>
  limit: ReturnType<typeof vi.fn>
  exec: ReturnType<typeof vi.fn>
}

const mockAvailabilityFind = (records: unknown[]) => {
  const chain: FakeFindChain = {
    select: vi.fn(() => chain),
    sort: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    exec: vi.fn(async () => records),
  }
  const find = vi
    .spyOn(ItemImprovementRecipeAvailabilityFact, 'find')
    .mockReturnValue(chain as never)
  return {
    chain,
    find,
  }
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(receivedAt)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('item improvement recipe v3 facts', () => {
  test('normalizes plugin-report detail payloads into a cost fact', async () => {
    const costUpdateOne = vi
      .spyOn(ItemImprovementRecipeCostFact, 'updateOne')
      .mockResolvedValue({} as never)

    const ctx = await invokeItemImprovementRecipePost({
      schemaVersion: 1,
      source: 'detail',
      clientObservedAt: observedAt,
      recipeId: '33',
      itemId: 700,
      itemLevel: 6,
      stage: 1,
      day: 6,
      observedSecondShipId: 0,
      observedFlagshipId: 101,
      observedFlagshipIds: [101, 103],
      fuel: 10,
      ammo: 20,
      steel: 30,
      bauxite: 40,
      buildkit: 3,
      remodelkit: 4,
      certainBuildkit: 5,
      certainRemodelkit: 6,
      reqSlotItems: [
        { id: 90, count: 2 },
        { id: 90, count: 1 },
        { id: 0, count: 0 },
      ],
      reqUseItems: [
        { id: 66, count: 2 },
        { id: 65, count: 1 },
      ],
      detailObserved: true,
    })

    expect(ctx.status).toBe(200)
    expect(ctx.body).toEqual({ records: 1 })
    expect(costUpdateOne).toHaveBeenCalledTimes(1)

    const update = costUpdateOne.mock.calls[0][1] as {
      $setOnInsert: {
        key: string
        recipeId: number
        itemId: number
        reqSlotItems: Array<{ id: number; count: number }>
        reqUseItems: Array<{ id: number; count: number }>
        changeFlag: number
      }
      $addToSet: {
        origins: string
        observedFlagshipIds: { $each: number[] }
      }
    }

    expect(update.$setOnInsert).toEqual(
      expect.objectContaining({
        key: 'v1|cost|33|700|6|1|6|0|10|20|30|40|3|4|5|6|90:3|65:1,66:2|0',
        recipeId: 33,
        itemId: 700,
        reqSlotItems: [{ id: 90, count: 3 }],
        reqUseItems: [
          { id: 65, count: 1 },
          { id: 66, count: 2 },
        ],
        changeFlag: 0,
      }),
    )
    expect(update.$addToSet).toEqual(
      expect.objectContaining({
        origins: reporterOrigin,
        observedFlagshipIds: { $each: [101, 103] },
      }),
    )
  })

  test('returns a 400 response for malformed required item pairs', async () => {
    const costUpdateOne = vi.spyOn(ItemImprovementRecipeCostFact, 'updateOne')

    const ctx = await invokeItemImprovementRecipePost({
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
      reqUseItems: [{ id: 65, count: 0 }],
    })

    expect(ctx.status).toBe(400)
    expect(ctx.body).toEqual({ error: 'reqUseItems.0: must contain positive id and count' })
    expect(costUpdateOne).not.toHaveBeenCalled()
  })

  test('builds deterministic keys for all fact types through batch ingestion', async () => {
    const availabilityUpdateOne = vi
      .spyOn(ItemImprovementRecipeAvailabilityFact, 'updateOne')
      .mockResolvedValue({} as never)
    const costUpdateOne = vi
      .spyOn(ItemImprovementRecipeCostFact, 'updateOne')
      .mockResolvedValue({} as never)
    const updateUpdateOne = vi
      .spyOn(ItemImprovementRecipeUpdateFact, 'updateOne')
      .mockResolvedValue({} as never)

    const ctx = await invokeItemImprovementRecipePost({
      records: [
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
      ],
    })

    expect(ctx.status).toBe(200)
    expect(ctx.body).toEqual({ records: 3 })
    expect(availabilityUpdateOne.mock.calls[0][0]).toEqual({
      key: 'v1|availability|33|700|6|0',
    })
    expect(costUpdateOne.mock.calls[0][0]).toEqual({
      key: 'v1|cost|33|700|6|1|6|0|10|20|30|40|3|4|5|6|90:2|65:1|0',
    })
    expect(updateUpdateOne.mock.calls[0][0]).toEqual({
      key: 'v1|update|33|700|10|6|102|701|0',
    })
  })

  test('uses insert-only stable fields and increments duplicate telemetry', async () => {
    const availabilityUpdateOne = vi
      .spyOn(ItemImprovementRecipeAvailabilityFact, 'updateOne')
      .mockResolvedValue({} as never)

    await invokeItemImprovementRecipePost({
      schemaVersion: 1,
      source: 'list',
      clientObservedAt: observedAt,
      recipeId: 33,
      itemId: 700,
      day: 6,
      observedSecondShipId: 0,
      observedFlagshipId: 101,
    })

    const update = availabilityUpdateOne.mock.calls[0][1] as {
      $setOnInsert: {
        firstReported: number
      }
      $min: {
        firstClientObservedAt: number
      }
      $addToSet: {
        sources: string
        origins: string
        observedFlagshipIds: { $each: number[] }
      }
      $inc: {
        count: number
      }
    }

    expect(update.$setOnInsert.firstReported).toBe(receivedAt)
    expect(update.$setOnInsert).not.toHaveProperty('firstClientObservedAt')
    expect(update.$min).toEqual({ firstClientObservedAt: observedAt })
    expect(update.$addToSet).toEqual({
      sources: 'list',
      origins: reporterOrigin,
      observedFlagshipIds: { $each: [101] },
    })
    expect(update.$inc).toEqual({ count: 1 })
  })

  test('rejects oversized ingest batches', async () => {
    const availabilityUpdateOne = vi.spyOn(ItemImprovementRecipeAvailabilityFact, 'updateOne')
    const records = Array.from({ length: 101 }, () => ({
      schemaVersion: 1,
      source: 'list',
      clientObservedAt: observedAt,
      recipeId: 33,
      itemId: 700,
      day: 6,
      observedSecondShipId: 0,
      observedFlagshipId: 101,
    }))

    const ctx = await invokeItemImprovementRecipePost({ records })

    expect(ctx.status).toBe(400)
    expect(ctx.body).toEqual({
      error: 'records: Too big: expected array to have <=100 items',
    })
    expect(availabilityUpdateOne).not.toHaveBeenCalled()
  })

  test('rejects invalid export cursors', async () => {
    const { find } = mockAvailabilityFind([])

    const ctx = await invokeAvailabilityExport({ afterId: 'invalid-object-id' })

    expect(ctx.status).toBe(400)
    expect(ctx.body).toEqual({ error: 'afterId: must be a valid ObjectId' })
    expect(find).not.toHaveBeenCalled()
  })

  test('exports facts with clamped limit, pagination cursor, and no origins', async () => {
    const firstId = new mongoose.Types.ObjectId()
    const secondId = new mongoose.Types.ObjectId()
    const { chain, find } = mockAvailabilityFind([
      {
        _id: firstId,
        key: 'v1|availability|33|700|6|0',
        lastReported: 2000,
      },
      {
        _id: secondId,
        key: 'v1|availability|34|701|6|0',
        lastReported: 3000,
      },
    ])

    const ctx = await invokeAvailabilityExport({
      updatedAfter: '1000',
      afterId: firstId.toString(),
      limit: '5000',
    })

    expect(ctx.status).toBe(200)
    expect(find.mock.calls[0][0]).toEqual({
      $or: [{ lastReported: { $gt: 1000 } }, { lastReported: 1000, _id: { $gt: firstId } }],
    })
    expect(chain.select).toHaveBeenCalledWith('-__v -origins')
    expect(chain.sort).toHaveBeenCalledWith({ lastReported: 1, _id: 1 })
    expect(chain.limit).toHaveBeenCalledWith(1000)
    expect(ctx.body).toEqual({
      records: [
        {
          _id: firstId,
          key: 'v1|availability|33|700|6|0',
          lastReported: 2000,
        },
        {
          _id: secondId,
          key: 'v1|availability|34|701|6|0',
          lastReported: 3000,
        },
      ],
      next: {
        updatedAfter: 3000,
        afterId: secondId.toString(),
      },
    })
  })
})

describe('report payload parsing', () => {
  test('returns 400 for malformed v2 JSON payloads', async () => {
    const ctx = await invokeReportPost(v2Router, '/create_ship', '{')

    expect(ctx.status).toBe(400)
    expect(ctx.body).toEqual({ error: 'data must be valid JSON' })
  })

  test.each([undefined, 1, [], '1'])(
    'returns 400 for missing/non-object v2 payloads: %s',
    async (data) => {
      const ctx = await invokeReportPost(v2Router, '/create_ship', data)

      expect(ctx.status).toBe(400)
      expect(ctx.body).toEqual({ error: 'data must be a JSON object' })
    },
  )

  test('returns 400 for missing v3 payload objects', async () => {
    const updateOne = vi.spyOn(Quest, 'updateOne')

    const ctx = await invokeReportPost(v3Router, '/quest', undefined)

    expect(ctx.status).toBe(400)
    expect(ctx.body).toEqual({ error: 'data must be a JSON object' })
    expect(updateOne).not.toHaveBeenCalled()
  })

  test('parses v3 JSON string payloads before saving quest records', async () => {
    const updateOne = vi.spyOn(Quest, 'updateOne').mockResolvedValue({} as never)

    const ctx = await invokeReportPost(
      v3Router,
      '/quest',
      JSON.stringify({
        quests: [
          {
            questId: 1,
            category: 2,
            title: 'Test quest',
            detail: 'Test details',
          },
        ],
      }),
    )

    expect(ctx.status).toBe(200)
    expect(updateOne).toHaveBeenCalledWith(
      {
        key: '8b6799d18daec4c67b34b883f9cfc2d0',
        questId: 1,
        category: 2,
      },
      {
        $setOnInsert: {
          questId: 1,
          category: 2,
          title: 'Test quest',
          detail: 'Test details',
          key: '8b6799d18daec4c67b34b883f9cfc2d0',
          origin: reporterOrigin,
        },
      },
      { upsert: true },
    )
  })
})
