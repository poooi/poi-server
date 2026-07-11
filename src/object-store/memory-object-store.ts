import { ObjectNotFoundError, type ObjectPutResult, type ObjectStore } from './object-store'

/**
 * In-memory {@link ObjectStore} used by every unit test and by the real-PostgreSQL e2e suite
 * (tests/server.postgres.e2e.test.ts), which must never depend on real Cloudflare R2/S3
 * credentials. Faithfully emulates the create-only, immutable contract: `putIfAbsent` never
 * replaces an existing key's bytes, and every stored/returned buffer is copied so callers can
 * never mutate this store's internal state (or have their own buffers mutated by it) by aliasing.
 */
export class InMemoryObjectStore implements ObjectStore {
  private readonly objects = new Map<string, Buffer>()

  async putIfAbsent(key: string, body: Buffer): Promise<ObjectPutResult> {
    if (this.objects.has(key)) {
      return { outcome: 'already-exists' }
    }
    this.objects.set(key, Buffer.from(body))
    return { outcome: 'created' }
  }

  async getObject(key: string): Promise<Buffer> {
    const stored = this.objects.get(key)
    if (stored === undefined) {
      throw new ObjectNotFoundError(`Object "${key}" does not exist in the in-memory object store`)
    }
    return Buffer.from(stored)
  }

  /** Test/e2e convenience: reports whether `key` is present without throwing. */
  has(key: string): boolean {
    return this.objects.has(key)
  }
}
