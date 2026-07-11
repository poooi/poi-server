import { createHash } from 'crypto'

import { describe, expect, test } from 'vitest'

import {
  compressCommunityDumpBuffer,
  decompressCommunityDumpBuffer,
  hasZstdContentChecksum,
} from '../src/dumps/community-dump-compression'

const sampleJsonLines = Buffer.from(
  Array.from(
    { length: 200 },
    (_, index) => JSON.stringify({ observationId: String(index), value: index % 7 }) + '\n',
  ).join(''),
  'utf8',
)

describe('compressCommunityDumpBuffer', () => {
  test('compresses with a standard Zstandard frame that has content checksums enabled', () => {
    const result = compressCommunityDumpBuffer(sampleJsonLines)

    // Zstandard magic number: 0x28 0xB5 0x2F 0xFD (little-endian encoding of 0xFD2FB528).
    expect(result.compressed.subarray(0, 4)).toEqual(Buffer.from([0x28, 0xb5, 0x2f, 0xfd]))
    expect(hasZstdContentChecksum(result.compressed)).toBe(true)
  })

  test('reports SHA-256 and byte-size metadata over the exact compressed bytes', () => {
    const result = compressCommunityDumpBuffer(sampleJsonLines)
    const expectedSha256 = createHash('sha256').update(result.compressed).digest('hex')

    expect(result.sha256).toBe(expectedSha256)
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(result.compressedBytes).toBe(String(result.compressed.length))
  })

  test('round-trips through decompression back to the exact original bytes', () => {
    const result = compressCommunityDumpBuffer(sampleJsonLines)
    const decompressed = decompressCommunityDumpBuffer(result.compressed)

    expect(Buffer.compare(decompressed, sampleJsonLines)).toBe(0)
  })

  test('rejects a compressed frame whose content checksum has been corrupted', () => {
    const result = compressCommunityDumpBuffer(sampleJsonLines)
    const corrupted = Buffer.from(result.compressed)
    // The trailing four bytes of a checksummed frame are the xxHash64 content checksum.
    corrupted[corrupted.length - 1] ^= 0xff

    expect(() => decompressCommunityDumpBuffer(corrupted)).toThrow()
  })

  test('produces byte-identical, deterministic output for identical input', () => {
    const first = compressCommunityDumpBuffer(sampleJsonLines)
    const second = compressCommunityDumpBuffer(Buffer.from(sampleJsonLines))

    expect(Buffer.compare(first.compressed, second.compressed)).toBe(0)
    expect(first.sha256).toBe(second.sha256)
    expect(first.compressedBytes).toBe(second.compressedBytes)
  })

  test('compresses an empty buffer into a valid, round-trippable frame', () => {
    const result = compressCommunityDumpBuffer(Buffer.alloc(0))
    expect(hasZstdContentChecksum(result.compressed)).toBe(true)
    expect(decompressCommunityDumpBuffer(result.compressed).length).toBe(0)
  })
})

describe('hasZstdContentChecksum', () => {
  test('returns false for a buffer too short to contain a frame header', () => {
    expect(hasZstdContentChecksum(Buffer.from([0x28, 0xb5]))).toBe(false)
  })

  test('returns false for a buffer with the wrong magic number', () => {
    expect(hasZstdContentChecksum(Buffer.from([0, 0, 0, 0, 0]))).toBe(false)
  })
})
