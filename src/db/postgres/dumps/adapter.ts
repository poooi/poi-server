import {
  type PartitionPoolClient,
  type PartitionQueryClient,
  type PartitionQueryResult,
} from '../partitions/adapter'

/**
 * Testable adapter around `pg`'s `Pool`/`PoolClient` plus the one capability the partition
 * maintenance seam's `PartitionQueryClient` (db/postgres/partitions/adapter.ts) does not need: a
 * way to stream a query's result rows one at a time via `pg-query-stream`, without buffering an
 * entire Observation partition (which can be arbitrarily large) into memory as a single
 * `PartitionQueryResult`. `DumpQueryClient` extends `PartitionQueryClient`, so every existing
 * catalog/dump-month/observation-tables/sql-safety helper that accepts a `PartitionQueryClient`
 * already accepts a `DumpQueryClient` too — nothing needs to be duplicated for those calls.
 *
 * `runInPartitionTransaction` (db/postgres/partitions/transaction.ts) cannot be reused for the
 * export phase: its `work` callback parameter type is hard-coded to the narrower
 * `PartitionQueryClient`, so a callback would need an unsafe cast to reach `streamQuery` —
 * forbidden in this codebase. The export phase also needs `REPEATABLE READ` (not the default
 * `READ COMMITTED`) and does not need the advisory lock `runInPartitionTransaction` always takes
 * (there is no concurrent DDL to guard against during a read-only streaming export), so
 * `runRepeatableReadDumpTransaction` (transaction.ts in this directory) is a deliberately
 * separate, minimal transaction wrapper for this one seam.
 *
 * Unlike `PartitionPool`, a real `pg.Pool` does not satisfy `DumpPool` directly — `pg` itself has
 * no streaming cursor support. Production wiring goes through
 * `pg-query-stream-adapter.ts#createDumpPoolFromPgPool`, which wraps a real `pg.Pool` and
 * implements `streamQuery` with the real `pg-query-stream` package.
 */

export interface DumpQueryRowStream {
  /** Async-iterates decoded rows one at a time; never buffers the full result set. */
  [Symbol.asyncIterator](): AsyncIterator<Record<string, unknown>>
  /** Destroys the underlying cursor/stream. Safe to call again after normal completion. */
  destroy(error?: Error): void
}

export interface DumpQueryClient extends PartitionQueryClient {
  /**
   * Streams `text`/`values` via a server-side cursor (a real `pg-query-stream` `QueryStream` in
   * production), reading `batchSize` rows per network round trip.
   */
  streamQuery: (text: string, values: readonly unknown[], batchSize: number) => DumpQueryRowStream
}

export interface DumpPoolClient extends DumpQueryClient, PartitionPoolClient {}

export interface DumpPool {
  connect: () => Promise<DumpPoolClient>
}

export type { PartitionQueryResult }
