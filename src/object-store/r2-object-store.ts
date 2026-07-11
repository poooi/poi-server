import {
  ObjectNotFoundError,
  ObjectStoreError,
  type ObjectPutResult,
  type ObjectStore,
} from './object-store'
import { createS3ObjectClient, type R2ObjectStoreConfig, type S3ObjectClient } from './r2-client'

export type { R2ObjectStoreConfig } from './r2-client'

/**
 * Cloudflare R2/S3 `ObjectStore` adapter (docs/postgresql-migration-plan.md lines 638-640).
 * Config comes only from explicit `POI_SERVER_DUMP_R2_*` environment variables, read by
 * {@link loadR2ObjectStoreConfigFromEnv}; the same bucket the operator configures is used for
 * every dump object, never inferred or overridden. Create-only semantics are implemented as a
 * `PutObjectCommand` with `IfNoneMatch: '*'`: PostgreSQL/S3-compatible storage rejects the
 * write with HTTP 412 (Precondition Failed) if the key already exists, which
 * {@link createObjectStoreFromS3Client} duck-types via `error.$metadata.httpStatusCode` (rather
 * than `instanceof` against SDK exception classes) so this translation logic can be unit
 * tested with a plain fake client and stays robust to any provider's imperfect error modeling.
 */

const REQUIRED_ENV_VAR_NAMES = [
  'POI_SERVER_DUMP_R2_ENDPOINT',
  'POI_SERVER_DUMP_R2_BUCKET',
  'POI_SERVER_DUMP_R2_ACCESS_KEY_ID',
  'POI_SERVER_DUMP_R2_SECRET_ACCESS_KEY',
] as const

/**
 * Loads Cloudflare R2 object-store configuration from `POI_SERVER_DUMP_R2_*` environment
 * variables. On any missing variable, throws an actionable error naming only the missing
 * variable name(s) — never a configured value — since `accessKeyId`/`secretAccessKey` are
 * secrets that must never be logged.
 */
export const loadR2ObjectStoreConfigFromEnv = (
  env: Partial<Record<string, string>> = process.env,
): R2ObjectStoreConfig => {
  const missing: string[] = []
  const readRequired = (name: string): string => {
    const value = env[name]
    if (!value) {
      missing.push(name)
      return ''
    }
    return value
  }

  const endpoint = readRequired(REQUIRED_ENV_VAR_NAMES[0])
  const bucket = readRequired(REQUIRED_ENV_VAR_NAMES[1])
  const accessKeyId = readRequired(REQUIRED_ENV_VAR_NAMES[2])
  const secretAccessKey = readRequired(REQUIRED_ENV_VAR_NAMES[3])

  if (missing.length > 0) {
    throw new ObjectStoreError(
      `Missing required Cloudflare R2 object-store environment variable(s): ${missing.join(', ')}`,
    )
  }

  return {
    endpoint,
    bucket,
    accessKeyId,
    secretAccessKey,
    region: env.POI_SERVER_DUMP_R2_REGION || 'auto',
    forcePathStyle: env.POI_SERVER_DUMP_R2_FORCE_PATH_STYLE !== 'false',
  }
}

const hasHttpStatusCode = (error: unknown, statusCode: number): boolean => {
  if (typeof error !== 'object' || error === null) {
    return false
  }
  if (!('$metadata' in error)) {
    return false
  }
  const metadata = error.$metadata
  if (typeof metadata !== 'object' || metadata === null) {
    return false
  }
  if (!('httpStatusCode' in metadata)) {
    return false
  }
  return metadata.httpStatusCode === statusCode
}

const isPreconditionFailed = (error: unknown): boolean => hasHttpStatusCode(error, 412)
const isNotFound = (error: unknown): boolean => hasHttpStatusCode(error, 404)
const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/**
 * Translates a raw {@link S3ObjectClient} into the create-only, immutable `ObjectStore`
 * contract. Fully unit-testable with a plain fake `S3ObjectClient` (see
 * tests/r2-object-store.test.ts) — never requires mocking `@aws-sdk/client-s3`.
 */
export const createObjectStoreFromS3Client = (
  client: S3ObjectClient,
  bucket: string,
): ObjectStore => ({
  putIfAbsent: async (key: string, body: Buffer): Promise<ObjectPutResult> => {
    try {
      await client.putObject({ bucket, key, body, ifNoneMatch: '*' })
      return { outcome: 'created' }
    } catch (error) {
      if (isPreconditionFailed(error)) {
        return { outcome: 'already-exists' }
      }
      throw new ObjectStoreError(
        `Failed to upload object "${key}" to bucket "${bucket}": ${errorMessage(error)}`,
      )
    }
  },
  getObject: async (key: string): Promise<Buffer> => {
    try {
      return await client.getObject({ bucket, key })
    } catch (error) {
      if (isNotFound(error)) {
        throw new ObjectNotFoundError(`Object "${key}" does not exist in bucket "${bucket}"`)
      }
      throw new ObjectStoreError(
        `Failed to read object "${key}" from bucket "${bucket}": ${errorMessage(error)}`,
      )
    }
  },
})

/** Convenience combinator: real R2 client wiring plus the pure create-only store logic. */
export const createR2ObjectStore = (config: R2ObjectStoreConfig): ObjectStore =>
  createObjectStoreFromS3Client(createS3ObjectClient(config), config.bucket)
