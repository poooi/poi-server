import { createHash } from 'crypto'

/**
 * Object-store port for the Community Dump publish/cleanup seam
 * (docs/postgresql-migration-plan.md lines 638-640, 748-752, 761-762). Every dump data object
 * and manifest is immutable and create-only: nothing in this codebase ever overwrites an object
 * that already exists under a given key. `putIfAbsent` reports whether it created a fresh object
 * or found one already present (a retry after a previous interrupted run); either way, callers
 * must treat the object as authoritative only after reading it back and verifying it (see
 * {@link putImmutableAndVerify}), never from the put call alone.
 *
 * Implementations: `InMemoryObjectStore` (src/object-store/memory-object-store.ts; tests, and the
 * real-PostgreSQL e2e suite, which never talks to real R2/S3) and `createR2ObjectStore`
 * (src/object-store/r2-object-store.ts; production Cloudflare R2).
 */

export class ObjectStoreError extends Error {}

/** Raised by `getObject` when no object exists under the given key. */
export class ObjectNotFoundError extends ObjectStoreError {}

/**
 * Raised whenever a read-back after `putIfAbsent` does not exactly match the expected content
 * (wrong length, wrong SHA-256, or the read-back itself failed) — for either a freshly created
 * object or one that already existed under that key.
 */
export class ObjectVerificationError extends ObjectStoreError {}

export type ObjectPutOutcome = 'created' | 'already-exists'

export interface ObjectPutResult {
  readonly outcome: ObjectPutOutcome
}

export interface ObjectStore {
  /**
   * Creates `key` with exactly `body` if it does not already exist. Never overwrites an
   * existing object: if `key` is already present, returns `{ outcome: 'already-exists' }`
   * without inspecting or replacing its content — callers must verify that existing content
   * matches what they expected via a separate `getObject` call (see
   * {@link putImmutableAndVerify}).
   */
  putIfAbsent(key: string, body: Buffer): Promise<ObjectPutResult>

  /** Reads back the exact bytes stored under `key`, or throws {@link ObjectNotFoundError}. */
  getObject(key: string): Promise<Buffer>
}

export interface ImmutablePutAndVerifyResult {
  readonly outcome: ObjectPutOutcome
  readonly bytes: number
  readonly sha256: string
}

const sha256Hex = (buffer: Buffer): string => createHash('sha256').update(buffer).digest('hex')

/**
 * Puts `body` under `key` (create-only) and then always reads it back to verify it is exactly
 * `body` — by length and by SHA-256, not by trusting the put outcome alone. This is the one
 * seam that satisfies, for both fresh uploads and retries against an already-published object,
 * every one of: "upload ... read it back from R2, and verify exact compressed byte count and
 * SHA-256" (plan lines 748-749); "read it back and verify the exact bytes" for the manifest
 * (line 751-752); and "must never overwrite a committed manifest ... existing object must match
 * or fail" (retry semantics, line 762).
 *
 * Throws {@link ObjectVerificationError} — never returns a false-success result — whenever the
 * read-back byte length or SHA-256 does not exactly match `expectedSha256Hex`, or when the
 * read-back itself fails for any reason.
 */
export const putImmutableAndVerify = async (
  store: ObjectStore,
  key: string,
  body: Buffer,
  expectedSha256Hex: string,
): Promise<ImmutablePutAndVerifyResult> => {
  const put = await store.putIfAbsent(key, body)

  let readBack: Buffer
  try {
    readBack = await store.getObject(key)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new ObjectVerificationError(
      `Object "${key}" ${put.outcome === 'created' ? 'was just uploaded' : 'already existed'} ` +
        `but could not be read back for verification: ${message}`,
    )
  }

  const expected = expectedSha256Hex.toLowerCase()
  const actual = sha256Hex(readBack)
  if (readBack.length !== body.length || actual !== expected) {
    const found = `${readBack.length} byte(s) / sha256 ${actual}`
    const wanted = `${body.length} byte(s) / sha256 ${expected}`
    if (put.outcome === 'already-exists') {
      throw new ObjectVerificationError(
        `Object "${key}" already exists in the object store but does not match the expected ` +
          `content (expected ${wanted}, found ${found}); refusing to treat it as a valid retry`,
      )
    }
    throw new ObjectVerificationError(
      `Object "${key}" was uploaded but failed read-back verification (expected ${wanted}, found ${found})`,
    )
  }

  return { outcome: put.outcome, bytes: readBack.length, sha256: actual }
}

export interface ObjectVerificationExpectation {
  readonly bytes: number
  readonly sha256Hex: string
}

/**
 * Re-reads `key` and verifies its content still matches `expected` exactly, for the cleanup
 * workflow's grace-period re-verification pass over an already-published object (plan lines
 * 754-756: "re-verify the manifest digest and size ... and re-verify every referenced object.
 * Any missing object, digest mismatch, [or] size mismatch ... blocks cleanup"), never a fresh
 * upload. Unlike {@link putImmutableAndVerify}, this never calls `putIfAbsent`, and it lets
 * {@link ObjectNotFoundError} from `getObject` propagate unchanged rather than rewrapping it, so
 * "missing object" and "digest/size mismatch" stay distinguishable to callers. Returns the
 * read-back bytes so callers that also need to parse the content (for example the manifest) do
 * not have to read it twice.
 */
export const verifyStoredObjectMatches = async (
  store: ObjectStore,
  key: string,
  expected: ObjectVerificationExpectation,
): Promise<Buffer> => {
  const readBack = await store.getObject(key)
  const actual = sha256Hex(readBack)
  const expectedSha256 = expected.sha256Hex.toLowerCase()
  if (readBack.length !== expected.bytes || actual !== expectedSha256) {
    throw new ObjectVerificationError(
      `Object "${key}" no longer matches its recorded metadata (expected ${expected.bytes} byte(s) ` +
        `/ sha256 ${expectedSha256}, found ${readBack.length} byte(s) / sha256 ${actual})`,
    )
  }
  return readBack
}
