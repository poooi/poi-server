import { describe, expect, test, vi } from 'vitest'

import {
  EXPECTED_POSTGRES_SCHEMA_VERSION,
  verifyPostgresSchema,
} from '../src/db/postgres/lifecycle'

const createQueryClient = (results: unknown[]) => ({
  query: vi.fn().mockImplementation(async () => results.shift()),
})

describe('PostgreSQL startup lifecycle', () => {
  test('accepts a compatible schema', async () => {
    const client = createQueryClient([{ rows: [{ version: EXPECTED_POSTGRES_SCHEMA_VERSION }] }])

    await expect(verifyPostgresSchema(client)).resolves.toBeUndefined()
  })

  test.each([
    [{ rows: [] }, 'schema metadata is missing'],
    [{ rows: [{ version: 0 }] }, 'expected schema version 3 but found 0'],
  ])('rejects an incompatible schema', async (schemaResult, message) => {
    const client = createQueryClient([schemaResult])

    await expect(verifyPostgresSchema(client)).rejects.toThrow(message)
  })
})
