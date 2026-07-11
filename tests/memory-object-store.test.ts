import { describe, expect, test } from 'vitest'

import { ObjectNotFoundError } from '../src/object-store/object-store'
import { InMemoryObjectStore } from '../src/object-store/memory-object-store'

/**
 * `InMemoryObjectStore` is the object store used by every unit test and by the real-PostgreSQL
 * e2e suite (which must never talk to real R2/S3 credentials). It must faithfully emulate the
 * create-only, immutable contract described by `src/object-store/object-store.ts`.
 */
describe('InMemoryObjectStore', () => {
  test('putIfAbsent on a fresh key stores the bytes and reports outcome "created"', async () => {
    const store = new InMemoryObjectStore()
    const body = Buffer.from('fresh object')

    const result = await store.putIfAbsent('key-1', body)

    expect(result).toEqual({ outcome: 'created' })
    await expect(store.getObject('key-1')).resolves.toEqual(body)
  })

  test('putIfAbsent on an existing key reports "already-exists" and never overwrites the stored bytes', async () => {
    const store = new InMemoryObjectStore()
    const original = Buffer.from('original content')
    const attemptedReplacement = Buffer.from('a completely different payload')

    await store.putIfAbsent('key-2', original)
    const result = await store.putIfAbsent('key-2', attemptedReplacement)

    expect(result).toEqual({ outcome: 'already-exists' })
    await expect(store.getObject('key-2')).resolves.toEqual(original)
  })

  test('getObject on a missing key throws ObjectNotFoundError', async () => {
    const store = new InMemoryObjectStore()

    await expect(store.getObject('never-written')).rejects.toThrow(ObjectNotFoundError)
  })

  test('getObject returns a defensive copy: mutating the returned buffer does not affect stored content', async () => {
    const store = new InMemoryObjectStore()
    const body = Buffer.from('immutable content')
    await store.putIfAbsent('key-3', body)

    const firstRead = await store.getObject('key-3')
    firstRead.write('MUTATED!!!!!!!!!!!')

    const secondRead = await store.getObject('key-3')
    expect(secondRead).toEqual(Buffer.from('immutable content'))
  })

  test('putIfAbsent stores a defensive copy: mutating the caller-supplied buffer after the call does not affect stored content', async () => {
    const store = new InMemoryObjectStore()
    const body = Buffer.from('caller-owned buffer')
    await store.putIfAbsent('key-4', body)

    body.write('OVERWRITTEN!!!!!!!!')

    await expect(store.getObject('key-4')).resolves.toEqual(Buffer.from('caller-owned buffer'))
  })

  test('has() reports whether a key is present without throwing', async () => {
    const store = new InMemoryObjectStore()
    expect(store.has('missing')).toBe(false)

    await store.putIfAbsent('present', Buffer.from('x'))
    expect(store.has('present')).toBe(true)
  })

  test('keys are independent: writing one key never affects another', async () => {
    const store = new InMemoryObjectStore()
    await store.putIfAbsent('a', Buffer.from('A'))
    await store.putIfAbsent('b', Buffer.from('B'))

    await expect(store.getObject('a')).resolves.toEqual(Buffer.from('A'))
    await expect(store.getObject('b')).resolves.toEqual(Buffer.from('B'))
  })
})
