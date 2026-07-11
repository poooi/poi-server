import { describe, expect, test } from 'vitest'

import { createPostgresPool } from '../src/db/postgres/client'

describe('PostgreSQL API pool', () => {
  test('configures ten-second statement and transaction timeouts', async () => {
    const pool = createPostgresPool('postgresql://localhost/poi-test', 4)
    try {
      expect(pool.options.max).toBe(4)
      expect(pool.options.options).toContain('statement_timeout=10000')
      expect(pool.options.options).toContain('transaction_timeout=10000')
    } finally {
      await pool.end()
    }
  })
})
