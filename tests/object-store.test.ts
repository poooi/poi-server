import { createHash } from 'crypto'

import { describe, expect, test } from 'vitest'

import {
  ObjectNotFoundError,
  ObjectVerificationError,
  putImmutableAndVerify,
  verifyStoredObjectMatches,
  type ObjectPutOutcome,
  type ObjectStore,
} from '../src/object-store/object-store'

/**
 * `putImmutableAndVerify` is the single seam both the R2 adapter and the in-memory test double
 * share: it always reads an object back after `putIfAbsent` and verifies exact byte length plus
 * SHA-256, regardless of whether the put created a fresh object or found one already there
 * (docs/postgresql-migration-plan.md lines 748-752, 761-762: "always read it back ... and verify
 * exact compressed byte count and SHA-256"; "must never overwrite a committed manifest").
 */

const sha256Hex = (buffer: Buffer): string => createHash('sha256').update(buffer).digest('hex')

interface FakeStoreOptions {
  readonly putOutcome: ObjectPutOutcome
  readonly readBack?: Buffer
  readonly readBackError?: Error
}

const createFakeStore = (
  options: FakeStoreOptions,
): { store: ObjectStore; putCalls: Array<{ key: string; body: Buffer }> } => {
  const putCalls: Array<{ key: string; body: Buffer }> = []
  const store: ObjectStore = {
    putIfAbsent: async (key, body) => {
      putCalls.push({ key, body })
      return { outcome: options.putOutcome }
    },
    getObject: async () => {
      if (options.readBackError) {
        throw options.readBackError
      }
      return options.readBack ?? Buffer.alloc(0)
    },
  }
  return { store, putCalls }
}

describe('putImmutableAndVerify', () => {
  test('a fresh create with exact read-back match succeeds and reports outcome "created"', async () => {
    const body = Buffer.from('hello community dump')
    const { store, putCalls } = createFakeStore({ putOutcome: 'created', readBack: body })

    const result = await putImmutableAndVerify(store, 'key-1', body, sha256Hex(body))

    expect(result).toEqual({ outcome: 'created', bytes: body.length, sha256: sha256Hex(body) })
    expect(putCalls).toEqual([{ key: 'key-1', body }])
  })

  test('a retry against an already-existing byte-identical object succeeds and reports outcome "already-exists"', async () => {
    const body = Buffer.from('retry payload, byte identical')
    const { store } = createFakeStore({ putOutcome: 'already-exists', readBack: body })

    const result = await putImmutableAndVerify(store, 'key-2', body, sha256Hex(body))

    expect(result).toEqual({
      outcome: 'already-exists',
      bytes: body.length,
      sha256: sha256Hex(body),
    })
  })

  test('an already-existing object with different bytes throws ObjectVerificationError, never a false success', async () => {
    const attempted = Buffer.from('this attempt')
    const existing = Buffer.from('unrelated content that was already stored under this key')
    const { store } = createFakeStore({ putOutcome: 'already-exists', readBack: existing })

    await expect(
      putImmutableAndVerify(store, 'key-3', attempted, sha256Hex(attempted)),
    ).rejects.toThrow(ObjectVerificationError)
  })

  test('a freshly created object whose read-back is corrupted (length mismatch) throws ObjectVerificationError', async () => {
    const uploaded = Buffer.from('uploaded bytes of one length')
    const corrupted = Buffer.from('short')
    const { store } = createFakeStore({ putOutcome: 'created', readBack: corrupted })

    await expect(
      putImmutableAndVerify(store, 'key-4', uploaded, sha256Hex(uploaded)),
    ).rejects.toThrow(ObjectVerificationError)
  })

  test('a freshly created object whose read-back has the same length but a different digest throws ObjectVerificationError', async () => {
    const uploaded = Buffer.from('aaaaaaaaaaaaaaaaaaaa')
    const sameLengthDifferentBytes = Buffer.from('bbbbbbbbbbbbbbbbbbbb')
    const { store } = createFakeStore({ putOutcome: 'created', readBack: sameLengthDifferentBytes })

    await expect(
      putImmutableAndVerify(store, 'key-5', uploaded, sha256Hex(uploaded)),
    ).rejects.toThrow(ObjectVerificationError)
  })

  test('a read-back failure immediately after a successful put is wrapped as ObjectVerificationError, never swallowed', async () => {
    const body = Buffer.from('flaky read-back')
    const { store } = createFakeStore({
      putOutcome: 'created',
      readBackError: new ObjectNotFoundError('simulated transient read-back failure'),
    })

    await expect(putImmutableAndVerify(store, 'key-6', body, sha256Hex(body))).rejects.toThrow(
      ObjectVerificationError,
    )
  })

  test('accepts an expected digest in any letter case', async () => {
    const body = Buffer.from('case insensitive digest')
    const { store } = createFakeStore({ putOutcome: 'created', readBack: body })

    const result = await putImmutableAndVerify(store, 'key-7', body, sha256Hex(body).toUpperCase())

    expect(result.outcome).toBe('created')
  })
})

/**
 * `verifyStoredObjectMatches` is the shared re-verification primitive the cleanup workflow uses
 * for its grace-period re-check (docs/postgresql-migration-plan.md lines 754-756: "re-verify the
 * manifest digest and size ... and re-verify every referenced object. Any missing object, digest
 * mismatch, [or] size mismatch ... blocks cleanup"). Unlike `putImmutableAndVerify`, it never
 * calls `putIfAbsent` — it only reads an already-published object back and checks it still
 * matches previously recorded metadata, without ever attempting to (re-)create anything.
 */
describe('verifyStoredObjectMatches', () => {
  const createReadOnlyStore = (options: {
    readBack?: Buffer
    readBackError?: Error
  }): ObjectStore => ({
    putIfAbsent: async () => {
      throw new Error('verifyStoredObjectMatches must never call putIfAbsent')
    },
    getObject: async () => {
      if (options.readBackError) {
        throw options.readBackError
      }
      return options.readBack ?? Buffer.alloc(0)
    },
  })

  test('returns the read-back bytes when length and digest exactly match', async () => {
    const body = Buffer.from('still exactly what we published')
    const store = createReadOnlyStore({ readBack: body })

    const result = await verifyStoredObjectMatches(store, 'key-1', {
      bytes: body.length,
      sha256Hex: sha256Hex(body),
    })

    expect(result).toEqual(body)
  })

  test('accepts an expected digest in any letter case', async () => {
    const body = Buffer.from('case insensitive digest, take two')
    const store = createReadOnlyStore({ readBack: body })

    await expect(
      verifyStoredObjectMatches(store, 'key-2', {
        bytes: body.length,
        sha256Hex: sha256Hex(body).toUpperCase(),
      }),
    ).resolves.toEqual(body)
  })

  test('throws ObjectVerificationError when the read-back length no longer matches', async () => {
    const original = Buffer.from('original content of some length')
    const truncated = Buffer.from('short now')
    const store = createReadOnlyStore({ readBack: truncated })

    await expect(
      verifyStoredObjectMatches(store, 'key-3', {
        bytes: original.length,
        sha256Hex: sha256Hex(original),
      }),
    ).rejects.toThrow(ObjectVerificationError)
  })

  test('throws ObjectVerificationError when the read-back digest no longer matches despite the same length', async () => {
    const original = Buffer.from('aaaaaaaaaaaaaaaaaaaa')
    const sameLengthDifferentBytes = Buffer.from('bbbbbbbbbbbbbbbbbbbb')
    const store = createReadOnlyStore({ readBack: sameLengthDifferentBytes })

    await expect(
      verifyStoredObjectMatches(store, 'key-4', {
        bytes: original.length,
        sha256Hex: sha256Hex(original),
      }),
    ).rejects.toThrow(ObjectVerificationError)
  })

  test('lets ObjectNotFoundError from a missing object propagate unchanged, never rewrapped', async () => {
    const store = createReadOnlyStore({
      readBackError: new ObjectNotFoundError('no object under this key'),
    })

    await expect(
      verifyStoredObjectMatches(store, 'key-5', { bytes: 10, sha256Hex: 'a'.repeat(64) }),
    ).rejects.toThrow(ObjectNotFoundError)
  })
})
