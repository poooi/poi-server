import { describe, expect, test, vi } from 'vitest'

import { migrateDatabase } from '../src/db/postgres/migrations'

describe('database migrations', () => {
  test('leaves MongoDB unchanged', async () => {
    const applyPostgresMigrations = vi.fn()

    await expect(
      migrateDatabase('mongodb://localhost/poi', '/drizzle', applyPostgresMigrations),
    ).resolves.toBe('mongodb')
    expect(applyPostgresMigrations).not.toHaveBeenCalled()
  })

  test.each(['postgres://localhost/poi', 'postgresql://localhost/poi'])(
    'applies PostgreSQL migrations for %s',
    async (databaseUrl) => {
      const applyPostgresMigrations = vi.fn().mockResolvedValue(undefined)

      await expect(migrateDatabase(databaseUrl, '/drizzle', applyPostgresMigrations)).resolves.toBe(
        'postgresql',
      )
      expect(applyPostgresMigrations).toHaveBeenCalledWith(databaseUrl, '/drizzle')
    },
  )

  test('does not hide PostgreSQL migration failures', async () => {
    const applyPostgresMigrations = vi.fn().mockRejectedValue(new Error('migration failed'))

    await expect(
      migrateDatabase('postgresql://localhost/poi', '/drizzle', applyPostgresMigrations),
    ).rejects.toThrow('migration failed')
  })
})
