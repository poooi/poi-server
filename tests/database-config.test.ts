import { afterEach, describe, expect, test, vi } from 'vitest'

import {
  redactDatabaseCredentials,
  resolveDatabaseBackend,
  resolveDatabaseUrl,
} from '../src/db/backend'

describe('database backend helpers', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  test('prefers POI_SERVER_DATABASE_URL over POI_SERVER_DB', () => {
    vi.stubEnv('POI_SERVER_DATABASE_URL', 'postgresql://localhost:5432/poi')
    vi.stubEnv('POI_SERVER_DB', 'mongodb://localhost:27017/poi')

    expect(resolveDatabaseUrl(process.env)).toBe('postgresql://localhost:5432/poi')
  })

  test('falls back to POI_SERVER_DB and then the legacy MongoDB default', () => {
    vi.stubEnv('POI_SERVER_DATABASE_URL', '')
    vi.stubEnv('POI_SERVER_DB', 'mongodb://localhost:27017/poi')
    expect(resolveDatabaseUrl(process.env)).toBe('mongodb://localhost:27017/poi')

    vi.stubEnv('POI_SERVER_DB', '')
    expect(resolveDatabaseUrl(process.env)).toBe('mongodb://localhost:27017/poi-development')
  })

  test('detects MongoDB and PostgreSQL URL schemes', () => {
    expect(resolveDatabaseBackend('mongodb://localhost:27017/poi')).toBe('mongo')
    expect(resolveDatabaseBackend('mongodb+srv://cluster0.example/poi')).toBe('mongo')
    expect(resolveDatabaseBackend('postgres://localhost:5432/poi')).toBe('postgres')
    expect(resolveDatabaseBackend('postgresql://localhost:5432/poi')).toBe('postgres')
  })

  test('rejects unsupported URL schemes with redacted credentials', () => {
    const url = `mysql://${['user', 'secret'].join(':')}@example.com/poi`

    expect(() => resolveDatabaseBackend(url)).toThrowError(
      'Unsupported database URL scheme in mysql://<redacted>@example.com/poi',
    )
  })

  test('redacts MongoDB and PostgreSQL credentials inside error messages', () => {
    const mongoMessage = `mongodb://${['user', 'secret'].join(':')}@example.com:27017/poi failed to connect`
    const postgresMessage = `postgresql://${['user', 'secret'].join(':')}@example.com:5432/poi failed to connect`

    expect(redactDatabaseCredentials(mongoMessage)).toBe(
      'mongodb://<redacted>@example.com:27017/poi failed to connect',
    )
    expect(redactDatabaseCredentials(postgresMessage)).toBe(
      'postgresql://<redacted>@example.com:5432/poi failed to connect',
    )
  })
})
