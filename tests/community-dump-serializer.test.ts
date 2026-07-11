import { describe, expect, test } from 'vitest'

import { CommunityDumpError } from '../src/dumps/community-dump-errors'
import { communityDumpDatasets } from '../src/dumps/community-dump-registry'
import {
  encodeCommunityDumpJsonLines,
  serializeCommunityDumpRecord,
} from '../src/dumps/community-dump-serializer'

const baseRow = {
  id: 42,
  ingested_at: '2024-01-15T03:04:05.006Z',
}

// One plausible non-null value per declared column for every dataset, keyed by the
// PostgreSQL snake_case source column so the table-driven key-order assertion below can
// also double as a full round-trip smoke test.
const sampleValuesByDataset: Record<string, Record<string, unknown>> = {
  createShipObservations: {
    items: [1, 2, 3],
    kdock_id: 1,
    secretary: 2,
    ship_id: 3,
    highspeed: 1,
    teitoku_lv: 99,
    large_flag: true,
    origin: 'poi',
  },
  createItemObservations: {
    items: [4, 5],
    secretary: 2,
    item_id: 10,
    teitoku_lv: 50,
    successful: true,
    origin: 'poi',
  },
  remodelItemObservations: {
    successful: true,
    item_id: 11,
    item_level: 2,
    flagship_id: 100,
    flagship_level: 30,
    flagship_cond: 40,
    consort_id: 101,
    consort_level: 31,
    consort_cond: 41,
    teitoku_lv: 60,
    certain: false,
  },
  dropShipObservations: {
    ship_id: 200,
    item_id: 12,
    map_id: 11,
    quest: 'quest',
    cell_id: 3,
    enemy: 'enemy',
    rank: 'S',
    is_boss: true,
    teitoku_lv: 70,
    map_lv: 5,
    enemy_ships1: [1, 2],
    enemy_ships2: [3, 4],
    enemy_formation: 1,
    base_exp: 120,
    teitoku_id: 'teitoku-1',
    owned_ship_snapshot: { b: 1, a: 2 },
    origin: 'poi',
  },
  passEventObservations: {
    teitoku_id: 'teitoku-2',
    teitoku_lv: 80,
    map_id: 12,
    map_lv: 6,
    rewards: [{ b: 1, a: 2 }],
    origin: 'poi',
  },
  battleApiObservations: {
    origin: 'poi',
    path: '/kcsapi/api_port/port',
    data: { b: 1, a: 2 },
  },
  nightContactObservations: {
    fleet_type: 1,
    ship_id: 300,
    ship_lv: 90,
    item_id: 13,
    item_lv: 1,
    contact: true,
  },
  aaciObservations: {
    poi_version: '13.0.0',
    available: [1, 2],
    triggered: 1,
    items: [14, 15],
    improvement: [1, 2],
    raw_luck: 10,
    raw_taiku: 20,
    lv: 99,
    hp_percent: 0.5,
    pos: 1,
    origin: 'poi',
  },
  nightBattleCiObservations: {
    ship_id: 400,
    ci: 'CI(Cut-in)',
    type: 'CI',
    lv: 99,
    raw_luck: 10,
    pos: 1,
    status: 'ok',
    items: [16, 17],
    improvement: [1, 2],
    search_light: false,
    flare: 0,
    defense_id: 1,
    defense_type_id: 2,
    ci_type: 3,
    display: [1, 2],
    hit_type: [1, 0],
    damage: [1.5, 2.5],
    damage_total: 4,
    time: 1700000000000,
    origin: 'poi',
  },
}

describe('serializeCommunityDumpRecord', () => {
  test.each(communityDumpDatasets.map((definition) => [definition.dataset, definition] as const))(
    '%s emits observationId, ingestedAt, then every listed key in exact order',
    (dataset, definition) => {
      const row = { ...baseRow, ...sampleValuesByDataset[dataset] }
      const line = serializeCommunityDumpRecord(dataset, row)
      const parsed = JSON.parse(line) as Record<string, unknown>

      expect(Object.keys(parsed)).toEqual([
        'observationId',
        'ingestedAt',
        ...definition.fields.map((field) => field.apiKey),
      ])
      expect(parsed.observationId).toBe('42')
      expect(parsed.ingestedAt).toBe('2024-01-15T03:04:05.006Z')
    },
  )

  test('nightBattleCiObservations maps the ci column to the uppercase CI key', () => {
    const row: Record<string, unknown> = {
      ...baseRow,
      ...sampleValuesByDataset.nightBattleCiObservations,
    }
    const parsed = JSON.parse(serializeCommunityDumpRecord('nightBattleCiObservations', row)) as {
      CI: unknown
    }
    expect(parsed.CI).toBe('CI(Cut-in)')
  })

  test('encodes node-postgres bigint time values as safe JSON numbers', () => {
    const row: Record<string, unknown> = {
      ...baseRow,
      ...sampleValuesByDataset.nightBattleCiObservations,
    }
    row.time = '1700000000123'

    const record = JSON.parse(serializeCommunityDumpRecord('nightBattleCiObservations', row))

    expect(record.time).toBe(1700000000123)
    expect(typeof record.time).toBe('number')
  })

  test('serializes SQL null as JSON null for scalar and array columns', () => {
    const row = {
      ...baseRow,
      items: null,
      kdock_id: null,
      secretary: null,
      ship_id: null,
      highspeed: null,
      teitoku_lv: null,
      large_flag: null,
      origin: null,
    }
    const parsed = JSON.parse(
      serializeCommunityDumpRecord('createShipObservations', row),
    ) as Record<string, unknown>
    expect(parsed).toEqual({
      observationId: '42',
      ingestedAt: '2024-01-15T03:04:05.006Z',
      items: null,
      kdockId: null,
      secretary: null,
      shipId: null,
      highspeed: null,
      teitokuLv: null,
      largeFlag: null,
      origin: null,
    })
  })

  test('treats an omitted column the same as an explicit SQL null', () => {
    const row = { ...baseRow }
    const parsed = JSON.parse(serializeCommunityDumpRecord('battleApiObservations', row)) as Record<
      string,
      unknown
    >
    expect(parsed).toEqual({
      observationId: '42',
      ingestedAt: '2024-01-15T03:04:05.006Z',
      origin: null,
      path: null,
      data: null,
    })
  })

  test('preserves array element order for integer array columns', () => {
    const row = { ...baseRow, ...sampleValuesByDataset.createShipObservations, items: [9, 1, 5] }
    const parsed = JSON.parse(serializeCommunityDumpRecord('createShipObservations', row)) as {
      items: number[]
    }
    expect(parsed.items).toEqual([9, 1, 5])
  })

  test('recursively sorts JSONB object keys lexicographically while preserving array order', () => {
    const row = {
      ...baseRow,
      ...sampleValuesByDataset.dropShipObservations,
      owned_ship_snapshot: {
        ships: [
          { name: 'z', hp: 1 },
          { hp: 2, name: 'a' },
        ],
        zzz: 1,
        aaa: { nested: { z: 1, a: 2 } },
      },
    }
    const line = serializeCommunityDumpRecord('dropShipObservations', row)
    const snapshotIndex = line.indexOf('"ownedShipSnapshot":')
    expect(snapshotIndex).toBeGreaterThan(-1)

    const parsed = JSON.parse(line) as { ownedShipSnapshot: unknown }
    expect(parsed.ownedShipSnapshot).toEqual({
      aaa: { nested: { a: 2, z: 1 } },
      ships: [
        { hp: 1, name: 'z' },
        { hp: 2, name: 'a' },
      ],
      zzz: 1,
    })
    // Assert the raw serialized key order directly (object insertion order === output order).
    expect(line).toContain('"ownedShipSnapshot":{"aaa":{"nested":{"a":2,"z":1}},"ships":[')
  })

  test.each([
    ['NaN scalar column', { hp_percent: Number.NaN }],
    ['Infinity scalar column', { hp_percent: Number.POSITIVE_INFINITY }],
    ['-Infinity scalar column', { hp_percent: Number.NEGATIVE_INFINITY }],
  ])('rejects %s before persistence', (_label, overrides) => {
    const row = { ...baseRow, ...sampleValuesByDataset.aaciObservations, ...overrides }
    expect(() => serializeCommunityDumpRecord('aaciObservations', row)).toThrow(CommunityDumpError)
  })

  test('rejects non-finite numbers nested inside JSONB payloads', () => {
    const row = {
      ...baseRow,
      ...sampleValuesByDataset.battleApiObservations,
      data: { nested: { value: Number.NaN } },
    }
    expect(() => serializeCommunityDumpRecord('battleApiObservations', row)).toThrow(
      CommunityDumpError,
    )
  })

  test('rejects non-finite numbers inside array columns', () => {
    const row = {
      ...baseRow,
      ...sampleValuesByDataset.nightBattleCiObservations,
      damage: [1.5, Number.POSITIVE_INFINITY],
    }
    expect(() => serializeCommunityDumpRecord('nightBattleCiObservations', row)).toThrow(
      CommunityDumpError,
    )
  })

  test.each([
    ['negative number', -1],
    ['non-integer number', 1.5],
    ['unsafe number', Number.MAX_SAFE_INTEGER + 2],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['non-numeric string', 'not-an-id'],
    ['negative decimal string', '-1'],
    ['leading-zero decimal string', '007'],
    ['empty string', ''],
    ['boolean', true],
    ['null', null],
    ['undefined', undefined],
    ['object', {}],
  ])('rejects an unsafe or invalid observationId (%s)', (_label, id) => {
    const row = { ...baseRow, ...sampleValuesByDataset.battleApiObservations, id }
    expect(() => serializeCommunityDumpRecord('battleApiObservations', row)).toThrow(
      CommunityDumpError,
    )
  })

  test('accepts a decimal-string, number, or bigint observationId equivalently', () => {
    const asNumber = JSON.parse(
      serializeCommunityDumpRecord('battleApiObservations', {
        ...baseRow,
        ...sampleValuesByDataset.battleApiObservations,
        id: 9007199254740991,
      }),
    ) as { observationId: string }
    const asString = JSON.parse(
      serializeCommunityDumpRecord('battleApiObservations', {
        ...baseRow,
        ...sampleValuesByDataset.battleApiObservations,
        id: '9007199254740991',
      }),
    ) as { observationId: string }
    const asBigInt = JSON.parse(
      serializeCommunityDumpRecord('battleApiObservations', {
        ...baseRow,
        ...sampleValuesByDataset.battleApiObservations,
        id: BigInt(9007199254740991),
      }),
    ) as { observationId: string }

    expect(asNumber.observationId).toBe('9007199254740991')
    expect(asString.observationId).toBe('9007199254740991')
    expect(asBigInt.observationId).toBe('9007199254740991')
  })

  test.each([
    ['invalid date string', 'not-a-date'],
    ['NaN', Number.NaN],
    ['null', null],
    ['undefined', undefined],
    ['boolean', true],
    ['object', {}],
  ])('rejects an unsafe or invalid ingestedAt (%s)', (_label, ingestedAt) => {
    const row = {
      ...baseRow,
      ...sampleValuesByDataset.battleApiObservations,
      ingested_at: ingestedAt,
    }
    expect(() => serializeCommunityDumpRecord('battleApiObservations', row)).toThrow(
      CommunityDumpError,
    )
  })

  test('accepts a Date, ISO string, or epoch-millisecond number for ingestedAt', () => {
    const iso = '2024-06-01T12:30:45.123Z'
    const fromDate = JSON.parse(
      serializeCommunityDumpRecord('battleApiObservations', {
        ...baseRow,
        ...sampleValuesByDataset.battleApiObservations,
        ingested_at: new Date(iso),
      }),
    ) as { ingestedAt: string }
    const fromString = JSON.parse(
      serializeCommunityDumpRecord('battleApiObservations', {
        ...baseRow,
        ...sampleValuesByDataset.battleApiObservations,
        ingested_at: iso,
      }),
    ) as { ingestedAt: string }
    const fromEpochMillis = JSON.parse(
      serializeCommunityDumpRecord('battleApiObservations', {
        ...baseRow,
        ...sampleValuesByDataset.battleApiObservations,
        ingested_at: new Date(iso).getTime(),
      }),
    ) as { ingestedAt: string }

    expect(fromDate.ingestedAt).toBe(iso)
    expect(fromString.ingestedAt).toBe(iso)
    expect(fromEpochMillis.ingestedAt).toBe(iso)
  })

  test('produces a compact single-line JSON object with no embedded newlines', () => {
    const row = { ...baseRow, ...sampleValuesByDataset.battleApiObservations }
    const line = serializeCommunityDumpRecord('battleApiObservations', row)
    expect(line).not.toContain('\n')
    expect(line).not.toContain('\r')
    expect(line).not.toContain('  ')
  })
})

describe('encodeCommunityDumpJsonLines', () => {
  test('joins records with a single LF terminator, ends with a trailing LF, and has no BOM', () => {
    const rows = [
      { ...baseRow, id: 1, ...sampleValuesByDataset.battleApiObservations },
      { ...baseRow, id: 2, ...sampleValuesByDataset.battleApiObservations },
    ]
    const buffer = encodeCommunityDumpJsonLines('battleApiObservations', rows)
    const text = buffer.toString('utf8')

    expect(buffer[0]).not.toBe(0xef) // UTF-8 BOM starts with 0xEF 0xBB 0xBF
    expect(text.endsWith('\n')).toBe(true)
    expect(text.includes('\r')).toBe(false)

    const lines = text.split('\n')
    expect(lines).toHaveLength(3) // two records plus the trailing empty segment after the last LF
    expect(lines[2]).toBe('')
    expect(JSON.parse(lines[0])).toMatchObject({ observationId: '1' })
    expect(JSON.parse(lines[1])).toMatchObject({ observationId: '2' })
  })

  test('produces an empty buffer for zero rows', () => {
    const buffer = encodeCommunityDumpJsonLines('battleApiObservations', [])
    expect(buffer.length).toBe(0)
  })
})
