import { Pool } from 'pg'
import { describe, expect, test } from 'vitest'

import { type PartitionPool } from '../src/db/postgres/partitions/adapter'

// Proves the testable adapter is satisfied by a real `pg.Pool` structurally, with no wrapper
// class and no cast (no `any`, no `as unknown as`): if `pg`'s exported types ever drift from
// this seam's minimal `PartitionPool`/`PartitionPoolClient` interfaces, this assignment fails to
// type-check (npm run type-check) even though the runtime assertions below still pass.
describe('PartitionPool adapter', () => {
  test('a real pg.Pool satisfies PartitionPool without a wrapper or cast', async () => {
    const pool = new Pool({ connectionString: 'postgresql://example.invalid/unused', max: 1 })
    const partitionPool: PartitionPool = pool
    expect(typeof partitionPool.connect).toBe('function')
    await pool.end()
  })
})
