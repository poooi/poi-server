import { describe, expect, test, vi } from 'vitest'

import {
  createDumpPoolFromPgPool,
  type QueryStreamConstructor,
} from '../src/db/postgres/dumps/pg-query-stream-adapter'
import { type DumpQueryRowStream } from '../src/db/postgres/dumps/adapter'

interface FakeQueryResult {
  readonly rows: ReadonlyArray<Record<string, unknown>>
  readonly rowCount: number | null
}

const makeFakePoolClient = () => {
  const queryCalls: Array<{ text: string; values: unknown }> = []
  const submittedStreams: unknown[] = []
  const releaseCalls: Array<Error | boolean | undefined> = []

  const client = {
    query: vi.fn((textOrStream: string | { submit: unknown }, values?: unknown) => {
      if (typeof textOrStream !== 'string') {
        submittedStreams.push(textOrStream)
        return textOrStream
      }
      queryCalls.push({ text: textOrStream, values })
      const result: FakeQueryResult = { rows: [{ id: 1 }], rowCount: 1 }
      return Promise.resolve(result)
    }),
    release: vi.fn((err?: Error | boolean) => {
      releaseCalls.push(err)
    }),
  }

  return { client, queryCalls, submittedStreams, releaseCalls }
}

const makeFakeQueryStreamConstructor = () => {
  const constructedWith: Array<{ text: string; values: unknown[]; config: { batchSize: number } }> =
    []
  let destroyedWith: Error | undefined
  const rows: ReadonlyArray<Record<string, unknown>> = [{ a: 1 }, { a: 2 }]

  const ctor = vi.fn(function (
    this: DumpQueryRowStream,
    text: string,
    values: unknown[],
    config: { batchSize: number },
  ) {
    constructedWith.push({ text, values, config })
    this[Symbol.asyncIterator] = () => {
      let index = 0
      return {
        next: async () => {
          if (index >= rows.length) {
            return { done: true as const, value: undefined }
          }
          return { done: false as const, value: rows[index++] }
        },
      }
    }
    this.destroy = (error?: Error) => {
      destroyedWith = error
    }
    // A real `QueryStream` also implements `Submittable`; the fake needs the same shape so the
    // fake pool client above can distinguish "this is a stream being submitted" from plain text.
    ;(this as unknown as { submit: () => void }).submit = () => {}
  }) as unknown as QueryStreamConstructor

  return { ctor, constructedWith, getDestroyedWith: () => destroyedWith }
}

describe('createDumpPoolFromPgPool', () => {
  test('connect() wraps a real pg.Pool#connect() client', async () => {
    const { client } = makeFakePoolClient()
    const pool = { connect: vi.fn().mockResolvedValue(client) }
    const dumpPool = createDumpPoolFromPgPool(pool as never)

    const dumpClient = await dumpPool.connect()

    expect(pool.connect).toHaveBeenCalledOnce()
    expect(dumpClient).toBeDefined()
  })

  test('query() delegates to the wrapped client.query() and shapes the result', async () => {
    const { client, queryCalls } = makeFakePoolClient()
    const pool = { connect: vi.fn().mockResolvedValue(client) }
    const dumpPool = createDumpPoolFromPgPool(pool as never)
    const dumpClient = await dumpPool.connect()

    const result = await dumpClient.query('select 1', ['a', 'b'])

    expect(queryCalls).toEqual([{ text: 'select 1', values: ['a', 'b'] }])
    expect(result).toEqual({ rows: [{ id: 1 }], rowCount: 1 })
  })

  test('query() tolerates an absent values array', async () => {
    const { client, queryCalls } = makeFakePoolClient()
    const pool = { connect: vi.fn().mockResolvedValue(client) }
    const dumpPool = createDumpPoolFromPgPool(pool as never)
    const dumpClient = await dumpPool.connect()

    await dumpClient.query('select 1')

    expect(queryCalls).toEqual([{ text: 'select 1', values: undefined }])
  })

  test('release() delegates to the wrapped client.release()', async () => {
    const { client, releaseCalls } = makeFakePoolClient()
    const pool = { connect: vi.fn().mockResolvedValue(client) }
    const dumpPool = createDumpPoolFromPgPool(pool as never)
    const dumpClient = await dumpPool.connect()

    dumpClient.release()
    const releaseError = new Error('boom')
    dumpClient.release(releaseError)

    expect(releaseCalls).toEqual([undefined, releaseError])
  })

  test('streamQuery() constructs a QueryStream with text/values/batchSize and submits it via client.query()', async () => {
    const { client, submittedStreams } = makeFakePoolClient()
    const pool = { connect: vi.fn().mockResolvedValue(client) }
    const { ctor, constructedWith } = makeFakeQueryStreamConstructor()
    const dumpPool = createDumpPoolFromPgPool(pool as never, ctor)
    const dumpClient = await dumpPool.connect()

    const stream = dumpClient.streamQuery('select * from only "observations"', ['x'], 500)

    expect(constructedWith).toEqual([
      { text: 'select * from only "observations"', values: ['x'], config: { batchSize: 500 } },
    ])
    expect(submittedStreams).toEqual([stream])
  })

  test('streamQuery() copies the values array so a readonly caller array is never mutated by reference', async () => {
    const { client } = makeFakePoolClient()
    const pool = { connect: vi.fn().mockResolvedValue(client) }
    const { ctor, constructedWith } = makeFakeQueryStreamConstructor()
    const dumpPool = createDumpPoolFromPgPool(pool as never, ctor)
    const dumpClient = await dumpPool.connect()

    const values: readonly unknown[] = ['a', 'b']
    dumpClient.streamQuery('select 1', values, 10)

    expect(constructedWith[0].values).toEqual(['a', 'b'])
    expect(constructedWith[0].values).not.toBe(values)
  })

  test('streamQuery() rows can be asynchronously iterated end to end', async () => {
    const { client } = makeFakePoolClient()
    const pool = { connect: vi.fn().mockResolvedValue(client) }
    const { ctor } = makeFakeQueryStreamConstructor()
    const dumpPool = createDumpPoolFromPgPool(pool as never, ctor)
    const dumpClient = await dumpPool.connect()

    const stream = dumpClient.streamQuery('select * from only "x"', [], 100)
    const collected: unknown[] = []
    for await (const row of stream) {
      collected.push(row)
    }

    expect(collected).toEqual([{ a: 1 }, { a: 2 }])
  })

  test('streamQuery() rows stream destroy() delegates to the underlying stream', async () => {
    const { client } = makeFakePoolClient()
    const pool = { connect: vi.fn().mockResolvedValue(client) }
    const { ctor, getDestroyedWith } = makeFakeQueryStreamConstructor()
    const dumpPool = createDumpPoolFromPgPool(pool as never, ctor)
    const dumpClient = await dumpPool.connect()

    const stream = dumpClient.streamQuery('select * from only "x"', [], 100)
    const error = new Error('abort')
    stream.destroy(error)

    expect(getDestroyedWith()).toBe(error)
  })

  test('defaults to the real pg-query-stream QueryStream constructor when none is injected', async () => {
    const { client, submittedStreams } = makeFakePoolClient()
    const pool = { connect: vi.fn().mockResolvedValue(client) }
    const dumpPool = createDumpPoolFromPgPool(pool as never)
    const dumpClient = await dumpPool.connect()

    const stream = dumpClient.streamQuery('select * from only "x"', [], 100)

    // A real `QueryStream` is a Node.js `Readable`, which is also `Symbol.asyncIterator`-able and
    // `destroy`-able — exactly what `DumpQueryRowStream` requires — without this file needing to
    // wrap it further.
    expect(typeof stream.destroy).toBe('function')
    expect(typeof stream[Symbol.asyncIterator]).toBe('function')
    expect(submittedStreams).toEqual([stream])
    stream.destroy()
  })
})
