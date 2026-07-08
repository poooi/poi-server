import { describe, expect, test } from 'vitest'

import { startServer } from '../src/server'

describe('PostgreSQL startup errors', () => {
  test('rejects unsupported database URL schemes before startup', async () => {
    await expect(
      startServer({
        db: ['mysql://', 'user:secret@', '127.0.0.1:3306/poi_server_test'].join(''),
        disableLogger: true,
        host: '127.0.0.1',
        loadLatestCommit: false,
        port: 0,
      }),
    ).rejects.toThrowError(
      'Unsupported database URL scheme "mysql:": mysql://<redacted>@127.0.0.1:3306/poi_server_test',
    )
  })

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
