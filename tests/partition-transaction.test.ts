import { describe, expect, test, vi } from 'vitest'

import {
  type PartitionPool,
  type PartitionPoolClient,
  type PartitionQueryResult,
} from '../src/db/postgres/partitions/adapter'
import { runInPartitionTransaction } from '../src/db/postgres/partitions/transaction'

const emptyResult: PartitionQueryResult = { rows: [], rowCount: 0 }

interface FakeClient extends PartitionPoolClient {
  readonly calls: Array<{ text: string; values: readonly unknown[] | undefined }>
}

const createFakeClient = (
  queryImpl?: (text: string, values?: readonly unknown[]) => Promise<PartitionQueryResult>,
): FakeClient => {
  const calls: FakeClient['calls'] = []
  return {
    calls,
    query: vi.fn(async (text: string, values?: readonly unknown[]) => {
      calls.push({ text, values })
      return queryImpl ? queryImpl(text, values) : emptyResult
    }),
    release: vi.fn(),
  }
}

const createFakePool = (client: FakeClient): PartitionPool => ({
  connect: vi.fn(async () => client),
})

// Shared BEGIN/transaction-scoped-advisory-lock/COMMIT/ROLLBACK/release boilerplate reused by
// both the create-upcoming-month and repair commands (docs/postgresql-migration-plan.md lines
// 713-739: "it takes an advisory and table lock ... and commits"). These tests inspect the exact
// query sequence and prove the safety properties: the client is always released, and any error
// from `work` triggers a rollback before the error propagates.
describe('runInPartitionTransaction', () => {
  test('begins, takes a transaction-scoped advisory lock keyed by lockKey, runs work, then commits', async () => {
    const client = createFakeClient()
    const pool = createFakePool(client)
    const work = vi.fn(async () => 'result')

    const result = await runInPartitionTransaction(
      pool,
      'poi-server:partition:create_ship_records:2026-07',
      work,
    )

    expect(result).toBe('result')
    expect(client.calls.map((call) => call.text)).toEqual([
      'begin',
      'select pg_advisory_xact_lock(hashtextextended($1, 0))',
      'commit',
    ])
    expect(client.calls[1].values).toEqual(['poi-server:partition:create_ship_records:2026-07'])
    expect(work).toHaveBeenCalledTimes(1)
    expect(work).toHaveBeenCalledWith(client)
  })

  test('runs work only after BEGIN and the advisory lock have both been issued', async () => {
    const client = createFakeClient()
    const pool = createFakePool(client)
    let queriesIssuedBeforeWork = -1
    const work = vi.fn(async () => {
      queriesIssuedBeforeWork = client.calls.length
      return undefined
    })

    await runInPartitionTransaction(pool, 'lock-key', work)

    expect(queriesIssuedBeforeWork).toBe(2)
  })

  test('always releases the client, even on success', async () => {
    const client = createFakeClient()
    const pool = createFakePool(client)

    await runInPartitionTransaction(pool, 'lock-key', async () => undefined)

    expect(client.release).toHaveBeenCalledTimes(1)
  })

  test('rolls back and rethrows when work rejects, without committing', async () => {
    const client = createFakeClient()
    const pool = createFakePool(client)
    const failure = new Error('boom')

    await expect(
      runInPartitionTransaction(pool, 'lock-key', async () => {
        throw failure
      }),
    ).rejects.toThrow(failure)

    expect(client.calls.map((call) => call.text)).toEqual([
      'begin',
      'select pg_advisory_xact_lock(hashtextextended($1, 0))',
      'rollback',
    ])
    expect(client.release).toHaveBeenCalledTimes(1)
  })

  test('still releases the client when the rollback itself fails', async () => {
    const failure = new Error('work failed')
    const client = createFakeClient(async (text) => {
      if (text === 'rollback') {
        throw new Error('connection already closed')
      }
      return emptyResult
    })
    const pool = createFakePool(client)

    await expect(
      runInPartitionTransaction(pool, 'lock-key', async () => {
        throw failure
      }),
    ).rejects.toThrow(failure)

    expect(client.release).toHaveBeenCalledTimes(1)
  })

  test('rolls back and rethrows when acquiring the advisory lock itself fails', async () => {
    const lockFailure = new Error('could not obtain lock')
    const client = createFakeClient(async (text) => {
      if (text.includes('pg_advisory_xact_lock')) {
        throw lockFailure
      }
      return emptyResult
    })
    const pool = createFakePool(client)
    const work = vi.fn()

    await expect(runInPartitionTransaction(pool, 'lock-key', work)).rejects.toThrow(lockFailure)

    expect(work).not.toHaveBeenCalled()
    expect(client.calls.map((call) => call.text)).toEqual([
      'begin',
      'select pg_advisory_xact_lock(hashtextextended($1, 0))',
      'rollback',
    ])
    expect(client.release).toHaveBeenCalledTimes(1)
  })
})
