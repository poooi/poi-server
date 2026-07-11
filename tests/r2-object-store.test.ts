import { createHash } from 'crypto'

import { describe, expect, test } from 'vitest'

import {
  ObjectNotFoundError,
  ObjectStoreError,
  putImmutableAndVerify,
} from '../src/object-store/object-store'
import {
  createObjectStoreFromS3Client,
  createR2ObjectStore,
  loadR2ObjectStoreConfigFromEnv,
} from '../src/object-store/r2-object-store'
import {
  type S3GetObjectInput,
  type S3ObjectClient,
  type S3PutObjectInput,
} from '../src/object-store/r2-client'

/**
 * `createObjectStoreFromS3Client` is the fully unit-testable seam that translates raw
 * S3-compatible responses/errors into the create-only `ObjectStore` contract, using a plain
 * fake `S3ObjectClient` — never a mock of `@aws-sdk/client-s3` itself
 * (docs/postgresql-migration-plan.md lines 638-640, 748-752, 761-762). `createS3ObjectClient`'s
 * real AWS SDK wiring is exercised only against real Cloudflare R2 in production, never in CI.
 */

const preconditionFailedError = (): Error =>
  Object.assign(new Error('At least one of the pre-conditions you specified did not hold'), {
    name: 'PreconditionFailed',
    $metadata: { httpStatusCode: 412 },
  })

const notFoundError = (): Error =>
  Object.assign(new Error('The specified key does not exist.'), {
    name: 'NoSuchKey',
    $metadata: { httpStatusCode: 404 },
  })

const internalServerError = (): Error =>
  Object.assign(new Error('We encountered an internal error, please try again.'), {
    name: 'InternalError',
    $metadata: { httpStatusCode: 500 },
  })

interface FakeS3ClientOptions {
  readonly putError?: Error
  readonly getError?: Error
  readonly getBody?: Buffer
}

const createFakeS3Client = (
  options: FakeS3ClientOptions = {},
): {
  client: S3ObjectClient
  putCalls: S3PutObjectInput[]
  getCalls: S3GetObjectInput[]
} => {
  const putCalls: S3PutObjectInput[] = []
  const getCalls: S3GetObjectInput[] = []
  const client: S3ObjectClient = {
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
      return options.getBody ?? Buffer.alloc(0)
    },
  }
  return { client, putCalls, getCalls }
}

describe('createObjectStoreFromS3Client', () => {
  test('putIfAbsent issues a create-only put (IfNoneMatch: "*") and reports "created" on success', async () => {
    const { client, putCalls } = createFakeS3Client()
    const store = createObjectStoreFromS3Client(client, 'dump-bucket')
    const body = Buffer.from('data object bytes')

    const result = await store.putIfAbsent('2024-01/x.jsonl.zst', body)

    expect(result).toEqual({ outcome: 'created' })
    expect(putCalls).toEqual([
      {
        bucket: 'dump-bucket',
        key: '2024-01/x.jsonl.zst',
        body,
        ifNoneMatch: '*',
      },
    ])
  })

  test('putIfAbsent translates a 412 Precondition Failed into "already-exists", not a thrown error', async () => {
    const { client } = createFakeS3Client({ putError: preconditionFailedError() })
    const store = createObjectStoreFromS3Client(client, 'dump-bucket')

    const result = await store.putIfAbsent('key', Buffer.from('x'))

    expect(result).toEqual({ outcome: 'already-exists' })
  })

  test('putIfAbsent never misclassifies an unrelated failure as "already-exists"; it rethrows as ObjectStoreError', async () => {
    const { client } = createFakeS3Client({ putError: internalServerError() })
    const store = createObjectStoreFromS3Client(client, 'dump-bucket')

    await expect(store.putIfAbsent('key', Buffer.from('x'))).rejects.toThrow(ObjectStoreError)
    await expect(store.putIfAbsent('key', Buffer.from('x'))).rejects.toThrow(/internal error/i)
  })

  test('getObject returns the exact bytes from the underlying client', async () => {
    const body = Buffer.from('manifest bytes')
    const { client, getCalls } = createFakeS3Client({ getBody: body })
    const store = createObjectStoreFromS3Client(client, 'dump-bucket')

    const result = await store.getObject('2024-01/manifest.json')

    expect(result).toEqual(body)
    expect(getCalls).toEqual([{ bucket: 'dump-bucket', key: '2024-01/manifest.json' }])
  })

  test('getObject translates a 404 into ObjectNotFoundError', async () => {
    const { client } = createFakeS3Client({ getError: notFoundError() })
    const store = createObjectStoreFromS3Client(client, 'dump-bucket')

    await expect(store.getObject('missing-key')).rejects.toThrow(ObjectNotFoundError)
  })

  test('getObject never misclassifies an unrelated failure as ObjectNotFoundError; it rethrows as ObjectStoreError', async () => {
    const { client } = createFakeS3Client({ getError: internalServerError() })
    const store = createObjectStoreFromS3Client(client, 'dump-bucket')

    await expect(store.getObject('key')).rejects.toThrow(ObjectStoreError)
    await expect(store.getObject('key')).rejects.not.toThrow(ObjectNotFoundError)
  })

  test('interoperates with putImmutableAndVerify: a retry against an already-uploaded, byte-identical object succeeds', async () => {
    const body = Buffer.from('idempotent retry payload')
    const { client } = createFakeS3Client({ putError: preconditionFailedError(), getBody: body })
    const store = createObjectStoreFromS3Client(client, 'dump-bucket')
    const sha256 = createHash('sha256').update(body).digest('hex')

    const result = await putImmutableAndVerify(store, 'key', body, sha256)

    expect(result.outcome).toBe('already-exists')
  })
})

describe('loadR2ObjectStoreConfigFromEnv', () => {
  const fullEnv = {
    POI_SERVER_DUMP_R2_ENDPOINT: 'https://account-id.r2.cloudflarestorage.com',
    POI_SERVER_DUMP_R2_BUCKET: 'community-dumps',
    POI_SERVER_DUMP_R2_ACCESS_KEY_ID: 'access-key-id-value',
    POI_SERVER_DUMP_R2_SECRET_ACCESS_KEY: 'super-secret-value',
  }

  test('loads all four required variables and defaults region to "auto" and forcePathStyle to true', () => {
    const config = loadR2ObjectStoreConfigFromEnv({ ...fullEnv })

    expect(config).toEqual({
      endpoint: fullEnv.POI_SERVER_DUMP_R2_ENDPOINT,
      bucket: fullEnv.POI_SERVER_DUMP_R2_BUCKET,
      accessKeyId: fullEnv.POI_SERVER_DUMP_R2_ACCESS_KEY_ID,
      secretAccessKey: fullEnv.POI_SERVER_DUMP_R2_SECRET_ACCESS_KEY,
      region: 'auto',
      forcePathStyle: true,
    })
  })

  test('allows overriding region and forcePathStyle', () => {
    const config = loadR2ObjectStoreConfigFromEnv({
      ...fullEnv,
      POI_SERVER_DUMP_R2_REGION: 'us-east-1',
      POI_SERVER_DUMP_R2_FORCE_PATH_STYLE: 'false',
    })

    expect(config.region).toBe('us-east-1')
    expect(config.forcePathStyle).toBe(false)
  })

  test('throws naming exactly the one missing variable', () => {
    const partialEnv = {
      POI_SERVER_DUMP_R2_ENDPOINT: fullEnv.POI_SERVER_DUMP_R2_ENDPOINT,
      POI_SERVER_DUMP_R2_ACCESS_KEY_ID: fullEnv.POI_SERVER_DUMP_R2_ACCESS_KEY_ID,
      POI_SERVER_DUMP_R2_SECRET_ACCESS_KEY: fullEnv.POI_SERVER_DUMP_R2_SECRET_ACCESS_KEY,
    }
    expect(() => loadR2ObjectStoreConfigFromEnv(partialEnv)).toThrow(/POI_SERVER_DUMP_R2_BUCKET/)
  })

  test('throws naming every missing variable when several are absent', () => {
    expect(() => loadR2ObjectStoreConfigFromEnv({})).toThrow(
      /POI_SERVER_DUMP_R2_ENDPOINT[\s\S]*POI_SERVER_DUMP_R2_BUCKET[\s\S]*POI_SERVER_DUMP_R2_ACCESS_KEY_ID[\s\S]*POI_SERVER_DUMP_R2_SECRET_ACCESS_KEY/,
    )
  })

  test('never includes any configured secret value in the missing-variable error message', () => {
    let thrownMessage = ''
    try {
      loadR2ObjectStoreConfigFromEnv({
        POI_SERVER_DUMP_R2_ACCESS_KEY_ID: fullEnv.POI_SERVER_DUMP_R2_ACCESS_KEY_ID,
        POI_SERVER_DUMP_R2_SECRET_ACCESS_KEY: fullEnv.POI_SERVER_DUMP_R2_SECRET_ACCESS_KEY,
      })
    } catch (error) {
      thrownMessage = error instanceof Error ? error.message : String(error)
    }
    expect(thrownMessage).not.toContain(fullEnv.POI_SERVER_DUMP_R2_ACCESS_KEY_ID)
    expect(thrownMessage).not.toContain(fullEnv.POI_SERVER_DUMP_R2_SECRET_ACCESS_KEY)
    expect(thrownMessage).toContain('POI_SERVER_DUMP_R2_ENDPOINT')
  })
})

describe('createR2ObjectStore', () => {
  test('combines the real S3 client wiring and the pure store logic into one ObjectStore', () => {
    const store = createR2ObjectStore({
      endpoint: 'https://account-id.r2.cloudflarestorage.com',
      bucket: 'community-dumps',
      accessKeyId: 'a',
      secretAccessKey: 'b',
      region: 'auto',
      forcePathStyle: true,
    })

    expect(typeof store.putIfAbsent).toBe('function')
    expect(typeof store.getObject).toBe('function')
  })
})
