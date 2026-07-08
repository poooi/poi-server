import { describe, expect, test } from 'vitest'

import { startServer } from '../src/server'

describe('PostgreSQL startup errors', () => {
  test('redacts credentials when postgres connection fails', async () => {
    await expect(
      startServer({
        db: ['postgres://', 'user:secret@', '127.0.0.1:1/poi_server_test'].join(''),
        disableLogger: true,
        host: '127.0.0.1',
        loadLatestCommit: false,
        port: 0,
      }),
    ).rejects.toThrowError(
      /^Unable to connect to database: .*postgres:\/\/<redacted>@127\.0\.0\.1:1\/poi_server_test/,
    )
  })
})
