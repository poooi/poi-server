import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'

// Community Dump publish/cleanup production-path e2e suite
// (docs/postgresql-migration-plan.md lines 622-811). Kept separate from
// tests/server.postgres.e2e.test.ts so its per-test truncate/partition fixtures never race this
// file's own monthly-partition lifecycle. Like that file, this suite requires a real PostgreSQL
// 18 service and never falls back to PGlite/R2 or any other embedded/in-memory implementation.
// Point it at a disposable local database whose name contains "poi-e2e" through
// POI_SERVER_POSTGRES_E2E_URL:
//
//   POI_SERVER_POSTGRES_E2E_URL=******localhost:5432/poi-e2e
//
// Before running this file, the target database must already have the Drizzle migrations applied
// through the explicit CI/local command (never automatically by the application):
//
//   POI_SERVER_DATABASE_URL=$POI_SERVER_POSTGRES_E2E_URL npm run db:migrate
//
// When POI_SERVER_POSTGRES_E2E_URL is unset, this suite skips cleanly (see describe.skipIf below).
// In CI, the variable is always set, so the suite always runs there.

import { Pool } from 'pg'

import { type DumpPool } from '../src/db/postgres/dumps/adapter'
import { cleanupDumpRun } from '../src/db/postgres/dumps/cleanup-dump-run'
import { CommunityDumpPreconditionError } from '../src/db/postgres/dumps/errors'
import { createDumpPoolFromPgPool } from '../src/db/postgres/dumps/pg-query-stream-adapter'
import { publishDumpMonth } from '../src/db/postgres/dumps/publish-dump-month'
import {
  assertExactMonthlyPartitionBounds,
  inspectPartitionCatalog,
} from '../src/db/postgres/partitions/catalog'
import { createUpcomingMonthPartitions } from '../src/db/postgres/partitions/create-upcoming-month'
import {
  computeDumpMonthBoundsUtc,
  deriveDefaultPartitionName,
  deriveMonthlyPartitionName,
  derivePendingPartitionName,
  parseDumpMonth,
} from '../src/db/postgres/partitions/dump-month'
import { observationParentTables } from '../src/db/postgres/partitions/observation-tables'
import { quoteIdentifier } from '../src/db/postgres/partitions/sql-safety'
import { type CommunityDumpDatasetName } from '../src/dumps/community-dump-dataset-name'
import { decompressCommunityDumpBuffer } from '../src/dumps/community-dump-compression'
import {
  communityDumpManifestSchemaVersion,
  parseCommunityDumpManifestV1,
} from '../src/dumps/community-dump-manifest'
import {
  deriveCommunityDumpDataObjectKey,
  deriveCommunityDumpManifestObjectKey,
} from '../src/dumps/community-dump-object-keys'
import {
  communityDumpDatasetNames,
  communityDumpDatasets,
} from '../src/dumps/community-dump-registry'
import { InMemoryObjectStore } from '../src/object-store/memory-object-store'
import { ObjectVerificationError, type ObjectStore } from '../src/object-store/object-store'

const postgresE2eUrl = process.env.POI_SERVER_POSTGRES_E2E_URL ?? ''
const isRunningInCi = process.env.CI === 'true' || process.env.CI === '1'
const hasPostgresE2eUrl = postgresE2eUrl !== ''

// A CI run that forgot to set the opt-in variable must fail loudly rather than silently skip the
// entire production-path parity suite.
if (!hasPostgresE2eUrl && isRunningInCi) {
  throw new Error(
    'POI_SERVER_POSTGRES_E2E_URL must be set when running in CI; the PostgreSQL e2e suite must not silently skip.',
  )
}

const localPostgresHosts = new Set(['localhost', '127.0.0.1', '::1'])

// Mirrors server.postgres.e2e.test.ts's (and server.e2e.test.ts's) safety check: refuse to run
// against anything that is not an explicitly-named, local, disposable database.
const assertPostgresE2eUrl = (rawUrl: string): void => {
  const url = new URL(rawUrl)
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error(
      `POI_SERVER_POSTGRES_E2E_URL must use a postgres: or postgresql: scheme, got ${url.protocol}`,
    )
  }
  const databaseName = url.pathname.replace(/^\/+/, '').split('?')[0]
  if (!databaseName.includes('poi-e2e')) {
    throw new Error(
      `Refusing to run PostgreSQL e2e tests against non-e2e database: ${databaseName || '<none>'}`,
    )
  }
  if (!localPostgresHosts.has(url.hostname)) {
    throw new Error(
      `Refusing to run PostgreSQL e2e tests against non-local PostgreSQL host: ${url.hostname}`,
    )
  }
}

let verificationPool: Pool
let dumpPool: DumpPool

/** `data_dump_runs.dump_month` is a `date` column; this is its literal `YYYY-MM-01` text form. */
const dumpMonthDateLiteral = (dumpMonth: string): string => `${dumpMonth}-01`

/**
 * One representative row's fixed insertion data plus the exact camelCase fields (in registry
 * key order) `serializeCommunityDumpRecord` must emit for it. Deliberately covers every payload
 * shape the serializer distinguishes: plain scalars, integer/double arrays, nested JSONB
 * objects/arrays (`dropShipObservations.ownedShipSnapshot`, `battleApiObservations.data`,
 * `passEventObservations.rewards`), and the one nullable `'safeInteger'`-encoded bigint column
 * (`nightBattleCiObservations.time`).
 */
interface RepresentativeRowFixture {
  readonly dataset: CommunityDumpDatasetName
  readonly table: string
  readonly columns: readonly string[]
  readonly values: readonly unknown[]
  readonly expectedFields: Record<string, unknown>
  readonly assertExtra?: (parsed: Record<string, unknown>) => void
}

const ownedShipSnapshotInput = {
  zzz: 1,
  ships: [
    { name: 'zeta-ship', hp: 10 },
    { hp: 20, name: 'alpha-ship' },
  ],
  aaa: { nested: { z: 1, a: 2 } },
}

const battleApiDataInput = { zeta: 1, alpha: { nested: [3, 2, 1] } }
const rewardsInput = [{ b: 1, a: 2 }]

const representativeRowFixtures: readonly RepresentativeRowFixture[] = [
  {
    dataset: 'createShipObservations',
    table: 'create_ship_records',
    columns: [
      'items',
      'kdock_id',
      'secretary',
      'ship_id',
      'highspeed',
      'teitoku_lv',
      'large_flag',
      'origin',
    ],
    values: [[11, 22, 33], 5, 101, 202, 1, 120, true, 'community-dump-e2e'],
    expectedFields: {
      items: [11, 22, 33],
      kdockId: 5,
      secretary: 101,
      shipId: 202,
      highspeed: 1,
      teitokuLv: 120,
      largeFlag: true,
      origin: 'community-dump-e2e',
    },
  },
  {
    dataset: 'createItemObservations',
    table: 'create_item_records',
    columns: ['items', 'secretary', 'item_id', 'teitoku_lv', 'successful', 'origin'],
    values: [[44, 55], 102, 700, 121, true, 'community-dump-e2e'],
    expectedFields: {
      items: [44, 55],
      secretary: 102,
      itemId: 700,
      teitokuLv: 121,
      successful: true,
      origin: 'community-dump-e2e',
    },
  },
  {
    dataset: 'remodelItemObservations',
    table: 'remodel_item_records',
    columns: [
      'successful',
      'item_id',
      'item_level',
      'flagship_id',
      'flagship_level',
      'flagship_cond',
      'consort_id',
      'consort_level',
      'consort_cond',
      'teitoku_lv',
      'certain',
    ],
    values: [true, 701, 6, 203, 99, 40, 204, 88, 35, 122, false],
    expectedFields: {
      successful: true,
      itemId: 701,
      itemLevel: 6,
      flagshipId: 203,
      flagshipLevel: 99,
      flagshipCond: 40,
      consortId: 204,
      consortLevel: 88,
      consortCond: 35,
      teitokuLv: 122,
      certain: false,
    },
  },
  {
    dataset: 'dropShipObservations',
    table: 'drop_ship_records',
    columns: [
      'ship_id',
      'item_id',
      'map_id',
      'quest',
      'cell_id',
      'enemy',
      'rank',
      'is_boss',
      'teitoku_lv',
      'map_lv',
      'enemy_ships1',
      'enemy_ships2',
      'enemy_formation',
      'base_exp',
      'teitoku_id',
      'owned_ship_snapshot',
      'origin',
    ],
    values: [
      205,
      702,
      11,
      'e2e-quest',
      3,
      'enemy-e2e',
      'S',
      true,
      123,
      2,
      [1, 2, 3],
      [4, 5],
      1,
      120,
      'teitoku-e2e-1',
      JSON.stringify(ownedShipSnapshotInput),
      'community-dump-e2e',
    ],
    expectedFields: {
      shipId: 205,
      itemId: 702,
      mapId: 11,
      quest: 'e2e-quest',
      cellId: 3,
      enemy: 'enemy-e2e',
      rank: 'S',
      isBoss: true,
      teitokuLv: 123,
      mapLv: 2,
      enemyShips1: [1, 2, 3],
      enemyShips2: [4, 5],
      enemyFormation: 1,
      baseExp: 120,
      teitokuId: 'teitoku-e2e-1',
      ownedShipSnapshot: {
        aaa: { nested: { a: 2, z: 1 } },
        ships: [
          { hp: 10, name: 'zeta-ship' },
          { hp: 20, name: 'alpha-ship' },
        ],
        zzz: 1,
      },
      origin: 'community-dump-e2e',
    },
    assertExtra: (parsed) => {
      const snapshot = parsed.ownedShipSnapshot as Record<string, unknown>
      expect(Object.keys(snapshot)).toEqual(['aaa', 'ships', 'zzz'])
      const aaa = snapshot.aaa as Record<string, unknown>
      expect(Object.keys(aaa.nested as Record<string, unknown>)).toEqual(['a', 'z'])
      const ships = snapshot.ships as Array<Record<string, unknown>>
      expect(ships.map((ship) => Object.keys(ship))).toEqual([
        ['hp', 'name'],
        ['hp', 'name'],
      ])
    },
  },
  {
    dataset: 'passEventObservations',
    table: 'pass_event_records',
    columns: ['teitoku_id', 'teitoku_lv', 'map_id', 'map_lv', 'rewards', 'origin'],
    values: ['teitoku-e2e-2', 124, 12, 3, JSON.stringify(rewardsInput), 'community-dump-e2e'],
    expectedFields: {
      teitokuId: 'teitoku-e2e-2',
      teitokuLv: 124,
      mapId: 12,
      mapLv: 3,
      rewards: [{ a: 2, b: 1 }],
      origin: 'community-dump-e2e',
    },
    assertExtra: (parsed) => {
      const rewards = parsed.rewards as Array<Record<string, unknown>>
      expect(rewards).toHaveLength(1)
      expect(Object.keys(rewards[0])).toEqual(['a', 'b'])
    },
  },
  {
    dataset: 'battleApiObservations',
    table: 'battle_apis',
    columns: ['origin', 'path', 'data'],
    values: ['community-dump-e2e', '/kcsapi/api_port/port', JSON.stringify(battleApiDataInput)],
    expectedFields: {
      origin: 'community-dump-e2e',
      path: '/kcsapi/api_port/port',
      data: { alpha: { nested: [3, 2, 1] }, zeta: 1 },
    },
    assertExtra: (parsed) => {
      const data = parsed.data as Record<string, unknown>
      expect(Object.keys(data)).toEqual(['alpha', 'zeta'])
    },
  },
  {
    dataset: 'nightContactObservations',
    table: 'night_contacts',
    columns: ['fleet_type', 'ship_id', 'ship_lv', 'item_id', 'item_lv', 'contact'],
    values: [1, 206, 90, 703, 5, true],
    expectedFields: {
      fleetType: 1,
      shipId: 206,
      shipLv: 90,
      itemId: 703,
      itemLv: 5,
      contact: true,
    },
  },
  {
    dataset: 'aaciObservations',
    table: 'aaci_records',
    columns: [
      'poi_version',
      'available',
      'triggered',
      'items',
      'improvement',
      'raw_luck',
      'raw_taiku',
      'lv',
      'hp_percent',
      'pos',
      'origin',
    ],
    values: ['13.2.0', [1, 2], 1, [80, 81], [1], 12, 34, 99, 0.75, 2, 'community-dump-e2e'],
    expectedFields: {
      poiVersion: '13.2.0',
      available: [1, 2],
      triggered: 1,
      items: [80, 81],
      improvement: [1],
      rawLuck: 12,
      rawTaiku: 34,
      lv: 99,
      hpPercent: 0.75,
      pos: 2,
      origin: 'community-dump-e2e',
    },
  },
  {
    dataset: 'nightBattleCiObservations',
    table: 'night_battle_cis',
    columns: [
      'ship_id',
      'ci',
      'type',
      'lv',
      'raw_luck',
      'pos',
      'status',
      'items',
      'improvement',
      'search_light',
      'flare',
      'defense_id',
      'defense_type_id',
      'ci_type',
      'display',
      'hit_type',
      'damage',
      'damage_total',
      'time',
      'origin',
    ],
    values: [
      207,
      'CI(Cut-in)',
      'CI',
      99,
      15,
      1,
      'ok',
      [90],
      [2],
      false,
      0,
      1,
      2,
      3,
      [1, 2],
      [1, 0],
      [12.5, 7.25],
      19.75,
      1700000000123,
      'community-dump-e2e',
    ],
    expectedFields: {
      shipId: 207,
      CI: 'CI(Cut-in)',
      type: 'CI',
      lv: 99,
      rawLuck: 15,
      pos: 1,
      status: 'ok',
      items: [90],
      improvement: [2],
      searchLight: false,
      flare: 0,
      defenseId: 1,
      defenseTypeId: 2,
      ciType: 3,
      display: [1, 2],
      hitType: [1, 0],
      damage: [12.5, 7.25],
      damageTotal: 19.75,
      time: 1700000000123,
      origin: 'community-dump-e2e',
    },
    assertExtra: (parsed) => {
      expect(typeof parsed.time).toBe('number')
      expect(parsed.time).toBe(1700000000123)
    },
  },
]

/** A month-inside timestamp, comfortably clear of both the lower and upper JST-month bounds. */
const ingestedAtFor = (dumpMonth: string): Date => {
  const bounds = computeDumpMonthBoundsUtc(parseDumpMonth(dumpMonth))
  return new Date(bounds.lowerBoundUtc.getTime() + 24 * 60 * 60 * 1000)
}

/**
 * Clears the canonical `data_dump_files`/`data_dump_runs` row for this Dump Month and current schema
 * version (FK-safe order), drops any monthly/pending partition artifact for every registered
 * Observation parent, and clears any stray DEFAULT-partition rows for the same month. Called both
 * before and after every test so a prior interrupted run can never leak into the next one, and so
 * this suite never leaves state behind afterward. Never touches `schema_metadata`.
 */
const resetDumpMonthArtifacts = async (dumpMonth: string): Promise<void> => {
  const parts = parseDumpMonth(dumpMonth)
  const bounds = computeDumpMonthBoundsUtc(parts)
  const dumpMonthDate = dumpMonthDateLiteral(dumpMonth)

  await verificationPool.query(
    `delete from data_dump_files
     where dump_run_id in (
       select id from data_dump_runs
       where dump_month = $1::date and schema_version = $2
     )`,
    [dumpMonthDate, communityDumpManifestSchemaVersion],
  )
  await verificationPool.query(
    `delete from data_dump_runs
     where dump_month = $1::date and schema_version = $2`,
    [dumpMonthDate, communityDumpManifestSchemaVersion],
  )

  for (const table of observationParentTables) {
    const monthlyName = deriveMonthlyPartitionName(table, parts)
    const pendingName = derivePendingPartitionName(table, parts)
    const defaultName = deriveDefaultPartitionName(table)
    await verificationPool.query(`drop table if exists ${quoteIdentifier(monthlyName)}`)
    await verificationPool.query(`drop table if exists ${quoteIdentifier(pendingName)}`)
    await verificationPool.query(
      `delete from only ${quoteIdentifier(defaultName)} where ingested_at >= $1 and ingested_at < $2`,
      [bounds.lowerBoundUtc, bounds.upperBoundUtc],
    )
  }
}

/** Inserts one representative row per Observation parent, all sharing one in-month timestamp. */
const insertRepresentativeRows = async (
  dumpMonth: string,
): Promise<{ ingestedAt: Date; idsByDataset: Map<CommunityDumpDatasetName, string> }> => {
  const ingestedAt = ingestedAtFor(dumpMonth)
  const idsByDataset = new Map<CommunityDumpDatasetName, string>()
  for (const fixture of representativeRowFixtures) {
    const columns = [...fixture.columns, 'ingested_at']
    const values = [...fixture.values, ingestedAt]
    const columnList = columns.map((column) => `"${column}"`).join(', ')
    const placeholders = values.map((_, index) => `$${index + 1}`).join(', ')
    const result = await verificationPool.query<{ id: string }>(
      `insert into "${fixture.table}" (${columnList}) values (${placeholders}) returning id::text as id`,
      values,
    )
    idsByDataset.set(fixture.dataset, result.rows[0].id)
  }
  return { ingestedAt, idsByDataset }
}

/**
 * Reads `fixture`'s compressed data object back out of `store`, decompresses it, and proves it
 * is exactly one JSON Lines record with the exact expected key order/values, decimal
 * `observationId`, and ISO `ingestedAt`. Returns the parsed record so callers can layer
 * additional (for example nested-key-order) assertions on top.
 */
const assertPublishedRecord = async (
  store: ObjectStore,
  dumpMonth: string,
  fixture: RepresentativeRowFixture,
  expectedObservationId: string,
  expectedIngestedAtIso: string,
): Promise<Record<string, unknown>> => {
  const objectKey = deriveCommunityDumpDataObjectKey(dumpMonth, fixture.dataset)
  const compressed = await store.getObject(objectKey)
  const decompressed = decompressCommunityDumpBuffer(compressed)
  const lines = decompressed
    .toString('utf8')
    .split('\n')
    .filter((line) => line.length > 0)
  expect(lines).toHaveLength(1)
  const parsed = JSON.parse(lines[0]) as Record<string, unknown>

  const expectedKeys = ['observationId', 'ingestedAt', ...Object.keys(fixture.expectedFields)]
  expect(Object.keys(parsed)).toEqual(expectedKeys)
  expect(parsed.observationId).toBe(expectedObservationId)
  expect(parsed.ingestedAt).toBe(expectedIngestedAtIso)
  for (const key of Object.keys(fixture.expectedFields)) {
    expect(parsed[key]).toEqual(fixture.expectedFields[key])
  }
  fixture.assertExtra?.(parsed)
  return parsed
}

describe.skipIf(!hasPostgresE2eUrl)('Community Dump publish/cleanup production-path e2e', () => {
  beforeAll(async () => {
    assertPostgresE2eUrl(postgresE2eUrl)
    verificationPool = new Pool({ connectionString: postgresE2eUrl, max: 5 })
    dumpPool = createDumpPoolFromPgPool(verificationPool)
  })

  afterAll(async () => {
    await verificationPool?.end()
  })

  test('publishes a Dump Month with one representative row per dataset, and a retry is byte-identical', async () => {
    const dumpMonth = '2024-01'
    await resetDumpMonthArtifacts(dumpMonth)
    try {
      const outcomes = await createUpcomingMonthPartitions(verificationPool, dumpMonth)
      expect(outcomes).toHaveLength(observationParentTables.length)
      expect(outcomes.every((outcome) => outcome.action === 'created')).toBe(true)

      const { ingestedAt, idsByDataset } = await insertRepresentativeRows(dumpMonth)
      const ingestedAtIso = ingestedAt.toISOString()

      const store = new InMemoryObjectStore()
      const putSpy = vi.spyOn(store, 'putIfAbsent')

      const run = await publishDumpMonth(dumpPool, store, dumpMonth)
      expect(run.status).toBe('published')

      const fileRows = await verificationPool.query<{ dataset: string; verified_at: Date | null }>(
        'select dataset, verified_at from data_dump_files where dump_run_id = $1',
        [run.id],
      )
      expect(fileRows.rows).toHaveLength(9)
      expect(new Set(fileRows.rows.map((row) => row.dataset))).toEqual(
        new Set(communityDumpDatasetNames),
      )
      expect(fileRows.rows.every((row) => row.verified_at !== null)).toBe(true)

      const puttedKeys = new Set(putSpy.mock.calls.map((call) => call[0]))
      expect(puttedKeys.size).toBe(10)

      const manifestKey = deriveCommunityDumpManifestObjectKey(dumpMonth)
      const manifestBytes = await store.getObject(manifestKey)
      const manifest = parseCommunityDumpManifestV1(manifestBytes)
      expect(manifest.files).toHaveLength(9)

      for (const fixture of representativeRowFixtures) {
        const expectedId = idsByDataset.get(fixture.dataset)
        if (expectedId === undefined) {
          throw new Error(`insertRepresentativeRows did not record an id for ${fixture.dataset}`)
        }
        await assertPublishedRecord(store, dumpMonth, fixture, expectedId, ingestedAtIso)
      }

      const beforeRetryBytes = new Map<string, Buffer>()
      for (const key of puttedKeys) {
        beforeRetryBytes.set(key, await store.getObject(key))
      }

      const retryRun = await publishDumpMonth(dumpPool, store, dumpMonth)
      expect(retryRun.id).toBe(run.id)
      expect(retryRun.status).toBe('published')

      const puttedKeysAfterRetry = new Set(putSpy.mock.calls.map((call) => call[0]))
      expect(puttedKeysAfterRetry.size).toBe(10)

      for (const [key, before] of beforeRetryBytes) {
        const after = await store.getObject(key)
        expect(after.equals(before)).toBe(true)
      }
    } finally {
      await resetDumpMonthArtifacts(dumpMonth)
    }
  })

  test('fails and marks the run failed when the first data object fails read-back verification, then a retry succeeds against the already-uploaded object', async () => {
    const dumpMonth = '2024-02'
    await resetDumpMonthArtifacts(dumpMonth)
    try {
      await createUpcomingMonthPartitions(verificationPool, dumpMonth)
      await insertRepresentativeRows(dumpMonth)

      const firstDatasetName = communityDumpDatasets[0].dataset
      const firstFixture = representativeRowFixtures.find(
        (fixture) => fixture.dataset === firstDatasetName,
      )
      if (!firstFixture) {
        throw new Error(`no representative row fixture for the first dataset ${firstDatasetName}`)
      }
      const firstDataObjectKey = deriveCommunityDumpDataObjectKey(dumpMonth, firstFixture.dataset)

      const store = new InMemoryObjectStore()
      const getObjectSpy = vi
        .spyOn(store, 'getObject')
        .mockImplementationOnce(async () => Buffer.from('not the export we produced', 'utf8'))

      await expect(publishDumpMonth(dumpPool, store, dumpMonth)).rejects.toThrow(
        ObjectVerificationError,
      )

      const failedRunRows = await verificationPool.query<{ id: string; status: string }>(
        `select id, status from data_dump_runs
         where dump_month = $1::date and schema_version = $2`,
        [dumpMonthDateLiteral(dumpMonth), communityDumpManifestSchemaVersion],
      )
      expect(failedRunRows.rows).toHaveLength(1)
      expect(failedRunRows.rows[0].status).toBe('failed')

      const manifestKey = deriveCommunityDumpManifestObjectKey(dumpMonth)
      expect(store.has(manifestKey)).toBe(false)
      // The underlying PUT for the first data object succeeded; only the read-back was corrupted.
      expect(store.has(firstDataObjectKey)).toBe(true)

      getObjectSpy.mockRestore()
      const firstObjectBytesBeforeRetry = await store.getObject(firstDataObjectKey)

      const retryRun = await publishDumpMonth(dumpPool, store, dumpMonth)
      expect(retryRun.status).toBe('published')
      expect(retryRun.id).toBe(Number(failedRunRows.rows[0].id))
      expect(store.has(manifestKey)).toBe(true)

      const firstObjectBytesAfterRetry = await store.getObject(firstDataObjectKey)
      expect(firstObjectBytesAfterRetry.equals(firstObjectBytesBeforeRetry)).toBe(true)
    } finally {
      await resetDumpMonthArtifacts(dumpMonth)
    }
  })

  test('refuses cleanup before the seven-day grace period elapses on the database clock, leaving every partition intact', async () => {
    const dumpMonth = '2024-03'
    await resetDumpMonthArtifacts(dumpMonth)
    try {
      await createUpcomingMonthPartitions(verificationPool, dumpMonth)
      await insertRepresentativeRows(dumpMonth)

      const store = new InMemoryObjectStore()
      const run = await publishDumpMonth(dumpPool, store, dumpMonth)
      expect(run.status).toBe('published')

      await expect(cleanupDumpRun(dumpPool, store, run.id)).rejects.toThrow(
        CommunityDumpPreconditionError,
      )

      const reloaded = await verificationPool.query<{ status: string }>(
        'select status from data_dump_runs where id = $1',
        [run.id],
      )
      expect(reloaded.rows).toHaveLength(1)
      expect(reloaded.rows[0].status).toBe('published')

      const parts = parseDumpMonth(dumpMonth)
      const bounds = computeDumpMonthBoundsUtc(parts)
      for (const table of observationParentTables) {
        const partitionName = deriveMonthlyPartitionName(table, parts)
        const info = await inspectPartitionCatalog(verificationPool, partitionName)
        expect(() =>
          assertExactMonthlyPartitionBounds(partitionName, info, {
            parentTable: table,
            lowerBoundUtc: bounds.lowerBoundUtc,
            upperBoundUtc: bounds.upperBoundUtc,
          }),
        ).not.toThrow()
      }
    } finally {
      await resetDumpMonthArtifacts(dumpMonth)
    }
  })

  test('cleans up an eligible run, is idempotent, and an already-cleaned rerun never reads the object store', async () => {
    const dumpMonth = '2024-04'
    const selectRankTeitokuId = 'community-dump-e2e-teitoku'
    const selectRankMapareaId = 990004
    const clearSelectRankRow = () =>
      verificationPool.query(
        'delete from select_rank_records where teitoku_id = $1 and maparea_id = $2',
        [selectRankTeitokuId, selectRankMapareaId],
      )

    await resetDumpMonthArtifacts(dumpMonth)
    await clearSelectRankRow()
    try {
      // Pre-insert the run's natural-key row with a stable, far-past published_at so its
      // cleanup_eligible_at (published_at + 7 days) is already in the past, without waiting for
      // a real seven-day grace period. findOrCreateDumpRun's ON CONFLICT DO UPDATE only ever
      // touches updated_at, so this published_at survives publish untouched (reservePublicationTimestamp's coalesce).
      const stablePublishedAt = new Date('2020-01-01T00:00:00.000Z')
      const preInsert = await verificationPool.query<{ id: string }>(
        `insert into data_dump_runs (dump_month, schema_version, status, published_at)
         values ($1::date, $2, 'pending', $3)
         returning id::text as id`,
        [dumpMonthDateLiteral(dumpMonth), communityDumpManifestSchemaVersion, stablePublishedAt],
      )
      const preInsertedId = preInsert.rows[0].id

      await createUpcomingMonthPartitions(verificationPool, dumpMonth)
      await insertRepresentativeRows(dumpMonth)

      // A stateful current-state row unrelated to the dump run, to prove cleanup never touches it.
      const selectRankInsert = await verificationPool.query<{ id: string }>(
        `insert into select_rank_records (teitoku_id, maparea_id, teitoku_lv, rank, origin)
         values ($1, $2, $3, $4, $5)
         returning id::text as id`,
        [selectRankTeitokuId, selectRankMapareaId, 130, 3, 'community-dump-e2e'],
      )
      const selectRankId = selectRankInsert.rows[0].id

      const store = new InMemoryObjectStore()
      const run = await publishDumpMonth(dumpPool, store, dumpMonth)
      expect(run.id).toBe(Number(preInsertedId))
      expect(run.status).toBe('published')

      const publishedAtRow = await verificationPool.query<{ published_at: Date }>(
        'select published_at from data_dump_runs where id = $1',
        [run.id],
      )
      expect(publishedAtRow.rows[0].published_at.toISOString()).toBe(
        stablePublishedAt.toISOString(),
      )

      const cleanupResult = await cleanupDumpRun(dumpPool, store, run.id)
      expect(cleanupResult).toEqual({
        runId: run.id,
        action: 'cleaned',
        partitionsDropped: expect.any(Array),
      })
      expect(cleanupResult.partitionsDropped).toHaveLength(9)

      const parts = parseDumpMonth(dumpMonth)
      for (const table of observationParentTables) {
        const partitionName = deriveMonthlyPartitionName(table, parts)
        const info = await inspectPartitionCatalog(verificationPool, partitionName)
        expect(info.relationExists).toBe(false)
      }

      const cleanedRow = await verificationPool.query<{ status: string; cleaned_at: Date | null }>(
        'select status, cleaned_at from data_dump_runs where id = $1',
        [run.id],
      )
      expect(cleanedRow.rows[0].status).toBe('cleaned')
      expect(cleanedRow.rows[0].cleaned_at).not.toBeNull()

      // Cleanup never touches the object store: every published object remains present.
      const manifestKey = deriveCommunityDumpManifestObjectKey(dumpMonth)
      expect(store.has(manifestKey)).toBe(true)
      for (const fixture of representativeRowFixtures) {
        const objectKey = deriveCommunityDumpDataObjectKey(dumpMonth, fixture.dataset)
        expect(store.has(objectKey)).toBe(true)
      }

      const selectRankRow = await verificationPool.query<{
        teitoku_lv: number
        rank: number
        origin: string
      }>('select teitoku_lv, rank, origin from select_rank_records where id = $1', [selectRankId])
      expect(selectRankRow.rows[0]).toEqual({
        teitoku_lv: 130,
        rank: 3,
        origin: 'community-dump-e2e',
      })

      const getObjectSpy = vi
        .spyOn(store, 'getObject')
        .mockRejectedValue(new Error('getObject must not be called for an already-cleaned run'))
      const rerunResult = await cleanupDumpRun(dumpPool, store, run.id)
      expect(rerunResult).toEqual({
        runId: run.id,
        action: 'already-cleaned',
        partitionsDropped: [],
      })
      expect(getObjectSpy).not.toHaveBeenCalled()
      getObjectSpy.mockRestore()
    } finally {
      await clearSelectRankRow()
      await resetDumpMonthArtifacts(dumpMonth)
    }
  })
})
