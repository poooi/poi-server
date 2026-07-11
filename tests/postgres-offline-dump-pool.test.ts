import { describe, expect, test } from 'vitest'

import { buildOfflineDumpPoolConfig, createOfflineDumpPool } from '../src/db/postgres/client'

const databaseUrl = 'postgresql://user:pass@localhost:5432/poi'

describe('buildOfflineDumpPoolConfig', () => {
  test('sets a short connection timeout and a generous idle timeout', () => {
    const config = buildOfflineDumpPoolConfig(databaseUrl)

    expect(config.connectionString).toBe(databaseUrl)
    expect(config.connectionTimeoutMillis).toBe(5000)
    expect(config.idleTimeoutMillis).toBe(30000)
  })

  test('defaults max to 3 and honors an explicit override', () => {
    expect(buildOfflineDumpPoolConfig(databaseUrl).max).toBe(3)
    expect(buildOfflineDumpPoolConfig(databaseUrl, 7).max).toBe(7)
  })

  test('sets an application_name identifying this as the offline dump pool', () => {
    const config = buildOfflineDumpPoolConfig(databaseUrl)
    expect(config.application_name).toBe('poi-server-dump-offline')
  })

  test('sets a lock_timeout but never a statement_timeout or query_timeout', () => {
    const config = buildOfflineDumpPoolConfig(databaseUrl)

    // Offline exports stream arbitrarily large partitions and must not be killed by a query
    // deadline; only lock acquisition (which should never block for long against a read-only
    // export) gets a timeout.
    expect(config.lock_timeout).toBeGreaterThan(0)
    expect(config.statement_timeout).toBeUndefined()
    expect(config.query_timeout).toBeUndefined()
    expect(config.options).toBeUndefined()
  })

  test('is a separate, independent pool config from the API pool (no shared object identity)', () => {
    const first = buildOfflineDumpPoolConfig(databaseUrl)
    const second = buildOfflineDumpPoolConfig(databaseUrl)
    expect(first).not.toBe(second)
  })
})

describe('createOfflineDumpPool', () => {
  test('returns a pg Pool configured with the offline dump pool options', () => {
    const pool = createOfflineDumpPool(databaseUrl)
    try {
      expect(pool.options.max).toBe(3)
      expect(pool.options.connectionTimeoutMillis).toBe(5000)
      expect(pool.options.idleTimeoutMillis).toBe(30000)
      expect(pool.options.application_name).toBe('poi-server-dump-offline')
      expect(pool.options.lock_timeout).toBeGreaterThan(0)
      expect(pool.options.statement_timeout).toBeUndefined()
    } finally {
      void pool.end()
    }
  })

  test('honors an explicit max override', () => {
    const pool = createOfflineDumpPool(databaseUrl, 1)
    try {
      expect(pool.options.max).toBe(1)
    } finally {
      void pool.end()
    }
  })
})
