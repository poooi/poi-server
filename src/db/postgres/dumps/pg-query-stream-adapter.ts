import { type Pool, type PoolClient, type Submittable } from 'pg'
import RealQueryStream from 'pg-query-stream'

import { type DumpPool, type DumpPoolClient, type DumpQueryRowStream } from './adapter'

/**
 * Production wiring for `DumpPool` (db/postgres/dumps/adapter.ts): wraps a real `pg.Pool` and
 * implements `streamQuery` with the real `pg-query-stream` package. Nothing else in this
 * codebase needs a real PostgreSQL connection to unit test the publish/cleanup workflows — they
 * only ever depend on the structural `DumpPool`/`DumpPoolClient` ports — so this adapter is the
 * one place a real `pg.Pool` and a real `QueryStream` cursor meet.
 *
 * `QueryStreamConstructor` is a second, optional constructor parameter deliberately typed to
 * match `pg-query-stream`'s real `QueryStream` class exactly (see
 * node_modules/pg-query-stream/dist/index.d.ts): production callers never pass it (the default
 * is the real class), while unit tests inject a fake constructor that returns a plain fake
 * `DumpQueryRowStream & Submittable`, so this file's own tests never open a real PostgreSQL
 * connection or cursor. Real `pg`/`pg-query-stream` compatibility is covered by the PostgreSQL
 * e2e suite instead (tests/server.postgres.e2e.test.ts and friends).
 *
 * `pg`'s own `ClientBase#query<T extends Submittable>(queryStream: T): T` overload is what
 * actually starts a `QueryStream` cursor flowing — the returned value is the same `QueryStream`
 * instance, already submitted to the connection — so `streamQuery` below constructs the stream,
 * hands it to `client.query`, and returns it directly with no further wrapping needed.
 */
export type QueryStreamConstructor = new (
  text: string,
  values: unknown[],
  config: { batchSize: number },
) => DumpQueryRowStream & Submittable

/**
 * `pg`'s query/`QueryStream` constructor parameter types are declared as plain mutable arrays
 * (`any[]`), which a `readonly unknown[]` is never assignable to (TypeScript does not consider a
 * `ReadonlyArray` a subtype of `Array`, regardless of element type). Copying once here is the
 * only way to satisfy that without an unsafe cast.
 */
const toMutableValues = (values: readonly unknown[]): unknown[] => [...values]

const wrapPoolClient = (
  client: PoolClient,
  queryStreamConstructor: QueryStreamConstructor,
): DumpPoolClient => ({
  query: async (text, values) => {
    const result = await client.query(text, values ? toMutableValues(values) : undefined)
    return { rows: result.rows, rowCount: result.rowCount }
  },
  release: (err) => client.release(err),
  streamQuery: (text, values, batchSize) => {
    const stream = new queryStreamConstructor(text, toMutableValues(values), { batchSize })
    client.query(stream)
    return stream
  },
})

export const createDumpPoolFromPgPool = (
  pool: Pool,
  queryStreamConstructor: QueryStreamConstructor = RealQueryStream,
): DumpPool => ({
  connect: async () => wrapPoolClient(await pool.connect(), queryStreamConstructor),
})
