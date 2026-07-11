import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mongooseMocks = vi.hoisted(() => ({
  connect: vi.fn(() => Promise.resolve()),
  connection: { on: vi.fn() },
}))

const postgresMocks = vi.hoisted(() => ({
  connectPostgres: vi.fn(),
}))

const createAppMock = vi.hoisted(() => vi.fn())

const fakeApp = vi.hoisted(() => ({
  listen: vi.fn(() => Promise.resolve()),
  close: vi.fn(() => Promise.resolve()),
  server: {},
}))

vi.mock('mongoose', () => ({
  default: mongooseMocks,
}))

vi.mock('../src/db/postgres/client', () => ({
  connectPostgres: postgresMocks.connectPostgres,
}))

vi.mock('../src/create-app', () => ({
  createApp: createAppMock,
}))

import { startServer } from '../src/server'
import { postgresV3ActionsUnavailable } from '../src/controllers/api/report/v3.postgres.actions'

describe('startServer backend routing', () => {
  beforeEach(() => {
    createAppMock.mockReturnValue(fakeApp)
    mongooseMocks.connect.mockClear()
    mongooseMocks.connection.on.mockClear()
    postgresMocks.connectPostgres.mockClear()
    fakeApp.listen.mockClear()
    fakeApp.close.mockClear()
    createAppMock.mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  test('routes MongoDB URLs through mongoose.connect and Mongo-default createApp options', async () => {
    const started = await startServer({
      db: 'mongodb://localhost:27017/poi-test',
      disableLogger: true,
      host: '127.0.0.1',
      loadLatestCommit: false,
      port: 0,
    })

    expect(mongooseMocks.connect).toHaveBeenCalledTimes(1)
    expect(postgresMocks.connectPostgres).not.toHaveBeenCalled()
    expect(createAppMock).toHaveBeenCalledTimes(1)
    const options = createAppMock.mock.calls[0][0]
    expect(options.getDatabaseStatus).toBeUndefined()
    expect(options.reportV2Actions).toBeUndefined()
    expect(options.reportV3Actions).toBeUndefined()

    await started.close()
    expect(fakeApp.close).toHaveBeenCalledTimes(1)
  })

  test('routes PostgreSQL URLs through connectPostgres and injects PostgreSQL v2/v3 action sets', async () => {
    const poolEnd = vi.fn(() => Promise.resolve())
    const fakeDb = { fake: 'db' }
    const fakeEpoch = { id: 'epoch-1', startedAt: null }
    postgresMocks.connectPostgres.mockResolvedValue({
      db: fakeDb,
      epoch: fakeEpoch,
      pool: { end: poolEnd },
    })

    const started = await startServer({
      db: 'postgresql://localhost:5432/poi-test',
      disableLogger: true,
      host: '127.0.0.1',
      loadLatestCommit: false,
      port: 0,
    })

    expect(postgresMocks.connectPostgres).toHaveBeenCalledTimes(1)
    expect(postgresMocks.connectPostgres).toHaveBeenCalledWith(
      'postgresql://localhost:5432/poi-test',
    )
    expect(mongooseMocks.connect).not.toHaveBeenCalled()
    expect(createAppMock).toHaveBeenCalledTimes(1)
    const options = createAppMock.mock.calls[0][0]
    expect(options.getDatabaseStatus).toBeTypeOf('function')
    expect(options.reportV2Actions).toBeDefined()
    expect(options.reportV3Actions).toBe(postgresV3ActionsUnavailable)

    await started.close()
    expect(fakeApp.close).toHaveBeenCalledTimes(1)
    expect(poolEnd).toHaveBeenCalledTimes(1)
  })

  test('never falls back to Mongo actions when the PostgreSQL connection fails', async () => {
    postgresMocks.connectPostgres.mockRejectedValue(new Error('schema mismatch'))

    await expect(
      startServer({
        db: 'postgresql://localhost:5432/poi-test',
        disableLogger: true,
        host: '127.0.0.1',
        loadLatestCommit: false,
        port: 0,
      }),
    ).rejects.toThrow(/schema mismatch/)

    expect(createAppMock).not.toHaveBeenCalled()
    expect(mongooseMocks.connect).not.toHaveBeenCalled()
  })

  test('closes the PostgreSQL pool when HTTP startup fails', async () => {
    const poolEnd = vi.fn(() => Promise.resolve())
    postgresMocks.connectPostgres.mockResolvedValue({
      db: { fake: 'db' },
      epoch: { id: 'epoch-1', startedAt: null },
      pool: { end: poolEnd },
    })
    fakeApp.listen.mockRejectedValueOnce(new Error('listen failed'))

    await expect(
      startServer({
        db: 'postgresql://localhost:5432/poi-test',
        disableLogger: true,
        host: '127.0.0.1',
        loadLatestCommit: false,
        port: 0,
      }),
    ).rejects.toThrow('listen failed')

    expect(poolEnd).toHaveBeenCalledOnce()
  })
})
