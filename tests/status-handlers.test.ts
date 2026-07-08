import { beforeEach, describe, expect, test, vi } from 'vitest'

const dfMock = vi.hoisted(() => vi.fn())
const getOtherActionsMock = vi.hoisted(() => vi.fn())

vi.mock('@sindresorhus/df', () => ({
  default: dfMock,
}))

vi.mock('../src/controllers/api/others.actions', () => ({
  getOtherActions: getOtherActionsMock,
}))

import { getStatus } from '../src/controllers/api/others.handlers'

const diskSample = [
  {
    mountpoint: '/',
    size: 10,
  },
  {
    mountpoint: '/data',
    size: 20,
  },
]

describe('status handler compatibility response', () => {
  beforeEach(() => {
    dfMock.mockResolvedValue(diskSample)
    getOtherActionsMock.mockReset()
  })

  test.each(['mongodb', 'postgres'] as const)(
    'returns legacy mongo counts and generic database counts for %s backend',
    async (backend) => {
      const counts = {
        CreateShipRecord: 1,
        CreateItemRecord: 2,
        RemodelItemRecord: 3,
        DropShipRecord: 4,
        SelectRankRecord: 5,
        PassEventRecord: 6,
        Quest: 7,
        BattleAPI: 8,
        AACIRecord: 9,
        NightContactRecord: 10,
      }

      getOtherActionsMock.mockReturnValue({
        getStatus: vi.fn(async () => counts),
      })

      const result = await getStatus({
        actions: {
          getStatus: vi.fn(async () => counts),
        },
        backend,
      })

      expect(result).toEqual({
        body: {
          database: {
            backend,
            counts,
          },
          disk: [diskSample[0]],
          env: process.env.NODE_ENV,
          mongo: counts,
        },
        status: 200,
      })
    },
  )
})
