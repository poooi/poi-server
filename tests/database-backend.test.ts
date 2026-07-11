import { describe, expect, test } from 'vitest'

import {
  redactDatabaseUrl,
  resolveDatabaseBackend,
  resolveDatabaseUrl,
} from '../src/db/backend'

describe('database backend configuration', () => {
  test('prefers POI_SERVER_DATABASE_URL and keeps POI_SERVER_DB as fallback', () => {
    expect(
      resolveDatabaseUrl({
        POI_SERVER_DATABASE_URL: 'postgresql://primary/poi',
        POI_SERVER_DB: 'mongodb://fallback/poi',
      }),
    ).toBe('postgresql://primary/poi')
    expect(resolveDatabaseUrl({ POI_SERVER_DB: 'mongodb://fallback/poi' })).toBe(
      'mongodb://fallback/poi',
    )
    expect(resolveDatabaseUrl({})).toBe('mongodb://localhost:27017/poi-development')
  })

  test.each([
    ['mongodb://localhost/poi', 'mongodb'],
    ['mongodb+srv://cluster/poi', 'mongodb'],
    ['postgres://localhost/poi', 'postgresql'],
    ['postgresql://localhost/poi', 'postgresql'],
  ] as const)('selects %s as %s', (databaseUrl, expected) => {
    expect(resolveDatabaseBackend(databaseUrl)).toBe(expected)
  })

  test('rejects unsupported schemes without exposing credentials', () => {
    expect(() => resolveDatabaseBackend('mysql://alice:secret@database/poi')).toThrow(
      'Unsupported database URL scheme in mysql://<redacted>@database/poi',
    )
  })

  test('redacts encoded credentials for supported database URLs', () => {
    expect(redactDatabaseUrl('postgresql://alice:p%40ssword@database/poi?sslmode=require')).toBe(
      'postgresql://<redacted>@database/poi?sslmode=require',
    )
    expect(redactDatabaseUrl('mongodb+srv://alice:secret@cluster/poi')).toBe(
      'mongodb+srv://<redacted>@cluster/poi',
    )
  })
})
