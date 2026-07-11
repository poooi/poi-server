import { createHash, randomBytes, randomUUID } from 'crypto'

import { createS3ObjectClient, type S3ConnectionCheckClient } from '../object-store/r2-client'
import { loadR2ObjectStoreConfigFromEnv } from '../object-store/r2-object-store'
import {
  collectR2Secrets,
  requireNoArgs,
  sanitizeCommandError,
  type CliEnv,
} from './dump-command-support'

export interface R2ConnectionCheckResult {
  readonly action: 'verified-and-deleted'
  readonly bucket: string
  readonly key: string
  readonly bytes: number
  readonly sha256: string
}

export interface R2ConnectionCheckCommandDeps {
  readonly loadR2Config: typeof loadR2ObjectStoreConfigFromEnv
  readonly createS3Client: (
    config: ReturnType<typeof loadR2ObjectStoreConfigFromEnv>,
  ) => S3ConnectionCheckClient
  readonly createProbeKey: () => string
  readonly createProbeBody: () => Buffer
}

export const defaultR2ConnectionCheckCommandDeps: R2ConnectionCheckCommandDeps = {
  loadR2Config: loadR2ObjectStoreConfigFromEnv,
  createS3Client: createS3ObjectClient,
  createProbeKey: () => `healthchecks/poi-server/r2-connection/${randomUUID()}`,
  createProbeBody: () => randomBytes(32),
}

export const r2ConnectionCheckCommandUsage = 'db:dumps:r2-check'

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const runR2ConnectionCheckCommand = async (
  args: readonly string[],
  env: CliEnv,
  deps: R2ConnectionCheckCommandDeps = defaultR2ConnectionCheckCommandDeps,
): Promise<R2ConnectionCheckResult> => {
  requireNoArgs(args, r2ConnectionCheckCommandUsage)

  const secrets: string[] = []
  try {
    const config = deps.loadR2Config(env)
    collectR2Secrets(config, secrets)
    const client = deps.createS3Client(config)
    const key = deps.createProbeKey()
    const body = deps.createProbeBody()
    const sha256 = createHash('sha256').update(body).digest('hex')

    let uploaded = false
    let verified = false
    let operationError: unknown
    try {
      await client.putObject({
        bucket: config.bucket,
        key,
        body,
        ifNoneMatch: '*',
      })
      uploaded = true

      const stored = await client.getObject({ bucket: config.bucket, key })
      if (!stored.equals(body)) {
        throw new Error(
          `R2 connection check read-back mismatch for temporary object "${key}" in bucket "${config.bucket}"`,
        )
      }
      verified = true
    } catch (error) {
      operationError = error
    }

    let cleanupError: unknown
    if (uploaded) {
      try {
        await client.deleteObject({ bucket: config.bucket, key })
      } catch (error) {
        cleanupError = error
      }
    }

    if (operationError !== undefined || cleanupError !== undefined) {
      const failures: string[] = []
      if (operationError !== undefined) {
        failures.push(`temporary object "${key}" probe failed: ${errorMessage(operationError)}`)
      }
      if (cleanupError !== undefined) {
        failures.push(`temporary object "${key}" cleanup failed: ${errorMessage(cleanupError)}`)
      }
      throw new Error(`R2 connection check failed:\n${failures.join('\n')}`)
    }

    if (!verified) {
      throw new Error('R2 connection check completed without verifying the temporary object')
    }

    return {
      action: 'verified-and-deleted',
      bucket: config.bucket,
      key,
      bytes: body.length,
      sha256,
    }
  } catch (error) {
    throw sanitizeCommandError(error, secrets)
  }
}
