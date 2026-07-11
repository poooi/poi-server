import { Readable } from 'stream'

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'

/**
 * Cloudflare R2 object-store configuration, loaded only from `POI_SERVER_DUMP_R2_*`
 * environment variables (see `loadR2ObjectStoreConfigFromEnv` in ./r2-object-store.ts).
 * `accessKeyId`/`secretAccessKey` are secrets: nothing in this module ever logs them.
 */
export interface R2ObjectStoreConfig {
  readonly endpoint: string
  readonly bucket: string
  readonly accessKeyId: string
  readonly secretAccessKey: string
  readonly region: string
  readonly forcePathStyle: boolean
}

export interface S3PutObjectInput {
  readonly bucket: string
  readonly key: string
  readonly body: Buffer
  readonly ifNoneMatch: string
}

export interface S3GetObjectInput {
  readonly bucket: string
  readonly key: string
}

export interface S3DeleteObjectInput {
  readonly bucket: string
  readonly key: string
}

/**
 * Minimal structural port over the two raw S3-compatible operations the Community Dump object
 * store needs. Deliberately raw: errors propagate exactly as the underlying client throws them,
 * with no interpretation here. `createObjectStoreFromS3Client`
 * (src/object-store/r2-object-store.ts) is the seam that duck-types the real HTTP status codes
 * (412 Precondition Failed for create-only conflicts, 404 Not Found for a missing object) —
 * kept in a separate module specifically so that translation logic stays fully unit-testable
 * with a plain fake `S3ObjectClient` (see tests/r2-object-store.test.ts), never requiring
 * `@aws-sdk/client-s3` itself to be mocked.
 */
export interface S3ObjectClient {
  putObject(input: S3PutObjectInput): Promise<void>
  getObject(input: S3GetObjectInput): Promise<Buffer>
}

export interface S3ConnectionCheckClient extends S3ObjectClient {
  deleteObject(input: S3DeleteObjectInput): Promise<void>
}

const streamToBuffer = async (stream: Readable): Promise<Buffer> => {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

/**
 * Wires a real `@aws-sdk/client-s3` `S3Client` configured for Cloudflare R2 into the
 * {@link S3ObjectClient} port. Only ever exercised against real R2 in production — no unit
 * test or e2e test in this repository uses real R2 credentials; `InMemoryObjectStore` stands in
 * everywhere else (docs/postgresql-migration-plan.md lines 638-640).
 */
export const createS3ObjectClient = (config: R2ObjectStoreConfig): S3ConnectionCheckClient => {
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })

  return {
    putObject: async ({ bucket, key, body, ifNoneMatch }) => {
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, IfNoneMatch: ifNoneMatch }),
      )
    },
    getObject: async ({ bucket, key }) => {
      const output = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
      if (!(output.Body instanceof Readable)) {
        throw new Error(`R2 GetObject for "${key}" did not return a Node.js Readable stream body`)
      }
      return streamToBuffer(output.Body)
    },
    deleteObject: async ({ bucket, key }) => {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
    },
  }
}
