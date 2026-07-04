import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import mongoose from 'mongoose'
import {
  ItemImprovementRecipeAvailabilityFact,
  ItemImprovementRecipeCostFact,
  ItemImprovementRecipeUpdateFact,
} from '../src/models'
import { router } from '../src/controllers/api/report/v3'

const reporterOrigin = 'Reporter/8.1.0 poi/10.3.99'
const observedAt = Date.UTC(2026, 6, 3, 15)
const receivedAt = observedAt

interface TestContext {
  request: {
    body: {
      data: unknown
    }
  }
  status?: number
  body?: unknown
  headers: Record<string, string>
  query: Record<string, unknown>
  get: (name: string) => string
  cashed: () => Promise<boolean>
}

interface RouteLayer {
  path: string
  methods: string[]
  stack: Array<(ctx: TestContext, next: () => Promise<void>) => Promise<void>>
}

const getItemImprovementRecipePostHandler = () => {
  const stack = (router as unknown as { stack: RouteLayer[] }).stack
  const layer = stack.find(
    (item) => item.path === '/item_improvement_recipe' && item.methods.includes('POST'),
  )
  if (layer == null) {
    throw new Error('item improvement recipe route is not registered')
  }
  return layer.stack[0]
}

const getAvailabilityExportHandler = () => {
  const stack = (router as unknown as { stack: RouteLayer[] }).stack
  const layer = stack.find(
    (item) =>
      item.path === '/item_improvement_recipes/availability' && item.methods.includes('GET'),
  )
  if (layer == null) {
    throw new Error('item improvement recipe availability export route is not registered')
  }
  return layer.stack[0]
}

const invokeItemImprovementRecipePost = async (data: unknown) => {
  const headers: Record<string, string> = {
    'x-reporter': reporterOrigin,
  }
  const ctx: TestContext = {
    request: {
      body: {
        data,
      },
    },
    headers,
    query: {},
    get: (name) => headers[name.toLowerCase()] || '',
    cashed: async () => false,
  }

  await getItemImprovementRecipePostHandler()(ctx, async () => undefined)
  return ctx
}

const invokeAvailabilityExport = async (query: Record<string, unknown>) => {
  const ctx: TestContext = {
    request: {
      body: {
        data: {},
      },
    },
    headers: {},
    query,
    get: () => '',
    cashed: async () => false,
  }

  await getAvailabilityExportHandler()(ctx, async () => undefined)
  return ctx
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
