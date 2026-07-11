import { describe, expect, test, vi } from 'vitest'

import {
  type DumpPool,
  type DumpPoolClient,
  type PartitionQueryResult,
} from '../src/db/postgres/dumps/adapter'
import { runRepeatableReadDumpTransaction } from '../src/db/postgres/dumps/transaction'

const emptyResult: PartitionQueryResult = { rows: [], rowCount: 0 }

interface FakeClient extends DumpPoolClient {
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
    streamQuery: vi.fn(() => {
      throw new Error('streamQuery not stubbed for this test')
    }),
    release: vi.fn(),
  }
}

const createFakePool = (client: FakeClient): DumpPool => ({
  connect: vi.fn(async () => client),
})

/**
 * Minimal BEGIN ISOLATION LEVEL REPEATABLE READ / COMMIT / ROLLBACK / release boilerplate for the
 * Community Dump publish workflow's streaming export phase (docs/postgresql-migration-plan.md
 * line 745: "In one REPEATABLE READ transaction, for each of the nine tables..."). Deliberately
 * distinct from `runInPartitionTransaction`: no advisory lock (there is no concurrent DDL to
 * guard against during a read-only streaming export) and `work` receives the full
 * `DumpPoolClient` (including `streamQuery`), not just a plain query client.
 */
describe('runRepeatableReadDumpTransaction', () => {
  test('begins with REPEATABLE READ isolation, runs work, then commits', async () => {
    const client = createFakeClient()
    const pool = createFakePool(client)
    const work = vi.fn(async () => 'result')

    const result = await runRepeatableReadDumpTransaction(pool, work)

    expect(result).toBe('result')
    expect(client.calls.map((call) => call.text)).toEqual([
      'begin isolation level repeatable read',
      'commit',
    ])
    expect(work).toHaveBeenCalledTimes(1)
    expect(work).toHaveBeenCalledWith(client)
  })

  test('passes work a client that exposes streamQuery (the whole point of this seam)', async () => {
    const client = createFakeClient()
    const pool = createFakePool(client)

    await runRepeatableReadDumpTransaction(pool, async (workClient) => {
      expect(typeof workClient.streamQuery).toBe('function')
      return undefined
    })
  })

  test('runs work only after BEGIN has been issued, before COMMIT', async () => {
    const client = createFakeClient()
    const pool = createFakePool(client)
    let queriesIssuedBeforeWork = -1

    await runRepeatableReadDumpTransaction(pool, async () => {
      queriesIssuedBeforeWork = client.calls.length
      return undefined
    })

    expect(queriesIssuedBeforeWork).toBe(1)
  })

  test('always releases the client, even on success', async () => {
    const client = createFakeClient()
    const pool = createFakePool(client)

    await runRepeatableReadDumpTransaction(pool, async () => undefined)

    expect(client.release).toHaveBeenCalledTimes(1)
  })

  test('rolls back and rethrows when work rejects, without committing', async () => {
    const client = createFakeClient()
    const pool = createFakePool(client)
    const failure = new Error('boom')

    await expect(
      runRepeatableReadDumpTransaction(pool, async () => {
        throw failure
      }),
    ).rejects.toThrow(failure)

    expect(client.calls.map((call) => call.text)).toEqual([
      'begin isolation level repeatable read',
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
      runRepeatableReadDumpTransaction(pool, async () => {
        throw failure
      }),
    ).rejects.toThrow(failure)

    expect(client.release).toHaveBeenCalledTimes(1)
  })

  test('rolls back and rethrows when BEGIN itself fails', async () => {
    const beginFailure = new Error('could not begin transaction')
    const client = createFakeClient(async (text) => {
      if (text.startsWith('begin')) {
        throw beginFailure
      }
      return emptyResult
    })
    const pool = createFakePool(client)
    const work = vi.fn()

    await expect(runRepeatableReadDumpTransaction(pool, work)).rejects.toThrow(beginFailure)

    expect(work).not.toHaveBeenCalled()
    expect(client.release).toHaveBeenCalledTimes(1)
  })
})
