import { describe, expect, test, vi } from 'vitest'

import {
  createDataEpoch,
  EXPECTED_POSTGRES_SCHEMA_VERSION,
  verifyPostgresDatabase,
} from '../src/db/postgres/lifecycle'

const createQueryClient = (results: unknown[]) => ({
  query: vi.fn().mockImplementation(async () => results.shift()),
})

describe('PostgreSQL startup lifecycle', () => {
  test('creates the sole Data Epoch through an explicit command', async () => {
    const startedAt = new Date('2026-07-11T08:00:00.000Z')
    const client = createQueryClient([
      { rows: [{ version: EXPECTED_POSTGRES_SCHEMA_VERSION }] },
      {
        rows: [
          {
            id: '9c29d1ca-5470-44c2-99a8-4623491f6424',
            started_at: startedAt,
          },
        ],
      },
    ])

    await expect(
      createDataEpoch(client, {
        id: '9c29d1ca-5470-44c2-99a8-4623491f6424',
        startedAt,
      }),
    ).resolves.toEqual({
      id: '9c29d1ca-5470-44c2-99a8-4623491f6424',
      startedAt: '2026-07-11T08:00:00.000Z',
    })
    expect(client.query).toHaveBeenLastCalledWith(
      expect.stringContaining('insert into data_epochs'),
      ['9c29d1ca-5470-44c2-99a8-4623491f6424', startedAt],
    )
  })

  test('refuses to replace an existing Data Epoch', async () => {
    const client = createQueryClient([
      { rows: [{ version: EXPECTED_POSTGRES_SCHEMA_VERSION }] },
      { rows: [] },
    ])

    await expect(
      createDataEpoch(client, {
        id: '9c29d1ca-5470-44c2-99a8-4623491f6424',
        startedAt: new Date(),
      }),
    ).rejects.toThrow('already has a Data Epoch')
  })

  test('returns the sole Data Epoch for a compatible schema', async () => {
    const startedAt = new Date('2026-07-11T08:00:00.000Z')
    const client = createQueryClient([
      { rows: [{ version: EXPECTED_POSTGRES_SCHEMA_VERSION }] },
      { rows: [{ id: '9c29d1ca-5470-44c2-99a8-4623491f6424', started_at: startedAt }] },
    ])

    await expect(verifyPostgresDatabase(client)).resolves.toEqual({
      id: '9c29d1ca-5470-44c2-99a8-4623491f6424',
      startedAt: '2026-07-11T08:00:00.000Z',
    })
  })

  test.each([
    [{ rows: [] }, 'schema metadata is missing'],
    [{ rows: [{ version: 0 }] }, 'expected schema version 1 but found 0'],
  ])('rejects an incompatible schema', async (schemaResult, message) => {
    const client = createQueryClient([schemaResult])

    await expect(verifyPostgresDatabase(client)).rejects.toThrow(message)
  })

  test.each([
    [{ rows: [] }, 'exactly one Data Epoch; found 0'],
    [
      {
        rows: [
          { id: 'one', started_at: new Date() },
          { id: 'two', started_at: new Date() },
        ],
      },
      'exactly one Data Epoch; found 2',
    ],
  ])('rejects invalid Data Epoch cardinality', async (epochResult, message) => {
    const client = createQueryClient([
      { rows: [{ version: EXPECTED_POSTGRES_SCHEMA_VERSION }] },
      epochResult,
    ])

    await expect(verifyPostgresDatabase(client)).rejects.toThrow(message)
  })
})
