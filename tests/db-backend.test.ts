import { describe, expect, test } from 'vitest'

import { redactConnectionCredentials, resolveBackend } from '../src/db/backend'

describe('database backend helpers', () => {
  test('redacts credentials from connection URLs', () => {
    const databaseUrl = ['postgres://', 'user:secret@', 'host:5432/db'].join('')
    expect(redactConnectionCredentials(databaseUrl)).toBe('postgres://<redacted>@host:5432/db')
  })

  test('resolves MongoDB URL schemes', () => {
    expect(resolveBackend('mongodb://localhost:27017/poi')).toBe('mongodb')
    expect(resolveBackend('mongodb+srv://cluster.example.com/poi')).toBe('mongodb')
  })

  test('resolves PostgreSQL URL schemes', () => {
    expect(resolveBackend('postgres://localhost:5432/poi')).toBe('postgres')
    expect(resolveBackend('postgresql://localhost:5432/poi')).toBe('postgres')
  })

  test('redacts credentials in unsupported scheme errors', () => {
    const databaseUrl = ['mysql://', 'user:secret@', 'host:3306/poi'].join('')
    expect(() => resolveBackend(databaseUrl)).toThrowError(
      'Unsupported database URL scheme "mysql:": mysql://<redacted>@host:3306/poi',
    )
  })

  test('throws a descriptive error for malformed URLs', () => {
    expect(() => resolveBackend('not a url')).toThrowError('Invalid database URL: not a url')
  })

  test('does not leak credentials in error messages', () => {
    const databaseUrl = ['mysql://', 'user:secret@', 'host:3306/poi'].join('')
    expect.assertions(3)

    try {
      resolveBackend(databaseUrl)
    } catch (err) {
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).message).not.toContain('user:secret')
      expect((err as Error).message).toContain('mysql://<redacted>@host:3306/poi')
    }
  })
})
