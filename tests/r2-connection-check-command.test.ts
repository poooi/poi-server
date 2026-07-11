import { createHash } from 'crypto'

import { describe, expect, test, vi } from 'vitest'

import {
  defaultR2ConnectionCheckCommandDeps,
  r2ConnectionCheckCommandUsage,
  runR2ConnectionCheckCommand,
  type R2ConnectionCheckCommandDeps,
} from '../src/cli/r2-connection-check-command'
import {
  createS3ObjectClient,
  type R2ObjectStoreConfig,
  type S3ConnectionCheckClient,
  type S3DeleteObjectInput,
  type S3GetObjectInput,
  type S3PutObjectInput,
} from '../src/object-store/r2-client'
import { loadR2ObjectStoreConfigFromEnv } from '../src/object-store/r2-object-store'

const config: R2ObjectStoreConfig = {
  endpoint: 'https://account-id.r2.cloudflarestorage.com',
  bucket: 'community-dumps',
  accessKeyId: 'connection-check-access-key',
  secretAccessKey: 'connection-check-secret-key',
  region: 'auto',
  forcePathStyle: true,
}

const probeKey = 'healthchecks/poi-server/r2-connection/test-id'
const probeBody = Buffer.from('temporary R2 connection check')

interface FakeClientOptions {
  readonly putError?: Error
  readonly getError?: Error
  readonly getBody?: Buffer
  readonly deleteError?: Error
}

const makeDeps = (
  options: FakeClientOptions = {},
  overrides: Partial<R2ConnectionCheckCommandDeps> = {},
): {
  deps: R2ConnectionCheckCommandDeps
  putCalls: S3PutObjectInput[]
  getCalls: S3GetObjectInput[]
  deleteCalls: S3DeleteObjectInput[]
} => {
  const putCalls: S3PutObjectInput[] = []
  const getCalls: S3GetObjectInput[] = []
  const deleteCalls: S3DeleteObjectInput[] = []
  const client: S3ConnectionCheckClient = {
    putObject: async (input) => {
      putCalls.push(input)
      if (options.putError) {
        throw options.putError
      }
    },
    getObject: async (input) => {
      getCalls.push(input)
      if (options.getError) {
        throw options.getError
      }
      return options.getBody ?? probeBody
    },
    deleteObject: async (input) => {
      deleteCalls.push(input)
      if (options.deleteError) {
        throw options.deleteError
      }
    },
  }
  const deps: R2ConnectionCheckCommandDeps = {
    loadR2Config: () => config,
    createS3Client: () => client,
    createProbeKey: () => probeKey,
    createProbeBody: () => probeBody,
    ...overrides,
  }
  return { deps, putCalls, getCalls, deleteCalls }
}

describe('runR2ConnectionCheckCommand', () => {
  test('uploads, reads, verifies, and deletes one unique temporary object', async () => {
    const { deps, putCalls, getCalls, deleteCalls } = makeDeps()

    const result = await runR2ConnectionCheckCommand([], {}, deps)

    expect(putCalls).toEqual([
      {
        bucket: config.bucket,
        key: probeKey,
        body: probeBody,
        ifNoneMatch: '*',
      },
    ])
    expect(getCalls).toEqual([{ bucket: config.bucket, key: probeKey }])
    expect(deleteCalls).toEqual([{ bucket: config.bucket, key: probeKey }])
    expect(result).toEqual({
      action: 'verified-and-deleted',
      bucket: config.bucket,
      key: probeKey,
      bytes: probeBody.length,
      sha256: createHash('sha256').update(probeBody).digest('hex'),
    })
  })

  test('rejects arguments before loading configuration', async () => {
    const loadR2Config = vi.fn(() => config)
    const { deps } = makeDeps({}, { loadR2Config })

    await expect(runR2ConnectionCheckCommand(['unexpected'], {}, deps)).rejects.toThrow(/Usage/)

    expect(loadR2Config).not.toHaveBeenCalled()
  })

  test('deletes the temporary object when read-back fails', async () => {
    const { deps, deleteCalls } = makeDeps({ getError: new Error('read failed') })

    await expect(runR2ConnectionCheckCommand([], {}, deps)).rejects.toThrow(/read failed/)

    expect(deleteCalls).toEqual([{ bucket: config.bucket, key: probeKey }])
  })

  test('deletes the temporary object when read-back bytes do not match', async () => {
    const { deps, deleteCalls } = makeDeps({ getBody: Buffer.from('different bytes') })

    await expect(runR2ConnectionCheckCommand([], {}, deps)).rejects.toThrow(/read-back mismatch/)

    expect(deleteCalls).toEqual([{ bucket: config.bucket, key: probeKey }])
  })

  test('does not delete when upload fails before an object is created', async () => {
    const { deps, getCalls, deleteCalls } = makeDeps({ putError: new Error('write denied') })

    await expect(runR2ConnectionCheckCommand([], {}, deps)).rejects.toThrow(/write denied/)

    expect(getCalls).toEqual([])
    expect(deleteCalls).toEqual([])
  })

  test('fails when the verified temporary object cannot be deleted', async () => {
    const { deps } = makeDeps({ deleteError: new Error('delete denied') })

    await expect(runR2ConnectionCheckCommand([], {}, deps)).rejects.toThrow(
      /temporary object ".*" cleanup failed: delete denied/,
    )
  })

  test('redacts R2 credentials from operation and cleanup failures', async () => {
    const { deps } = makeDeps({
      getError: new Error(`read failed for ${config.accessKeyId}`),
      deleteError: new Error(`delete failed for ${config.secretAccessKey}`),
    })

    let thrown: Error | undefined
    try {
      await runR2ConnectionCheckCommand([], {}, deps)
    } catch (error) {
      thrown = error as Error
    }

    expect(thrown?.message).toContain('<redacted>')
    expect(thrown?.message).not.toContain(config.accessKeyId)
    expect(thrown?.message).not.toContain(config.secretAccessKey)
  })
})

describe('defaultR2ConnectionCheckCommandDeps', () => {
  test('wires production R2 configuration and client factories', () => {
    expect(defaultR2ConnectionCheckCommandDeps.loadR2Config).toBe(loadR2ObjectStoreConfigFromEnv)
    expect(defaultR2ConnectionCheckCommandDeps.createS3Client).toBe(createS3ObjectClient)
    expect(defaultR2ConnectionCheckCommandDeps.createProbeKey()).toMatch(
      /^healthchecks\/poi-server\/r2-connection\/[0-9a-f-]{36}$/,
    )
    expect(defaultR2ConnectionCheckCommandDeps.createProbeBody()).toHaveLength(32)
  })
})

test('r2ConnectionCheckCommandUsage documents the no-argument command', () => {
  expect(r2ConnectionCheckCommandUsage).toBe('db:dumps:r2-check')
})
