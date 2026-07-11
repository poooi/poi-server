import { createHash } from 'crypto'
import { once } from 'events'

import { describe, expect, test } from 'vitest'

import {
  compressCommunityDumpBuffer,
  createCommunityDumpCompressStream,
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

/** Writes every chunk in `inputs` into `stream`, ends it, and collects the compressed output. */
const drainCompressStream = async (
  stream: ReturnType<typeof createCommunityDumpCompressStream>,
  inputs: readonly Buffer[],
): Promise<Buffer> => {
  const chunks: Buffer[] = []
  stream.on('data', (chunk: Buffer) => {
    chunks.push(chunk)
  })
  const ended = once(stream, 'end')
  for (const input of inputs) {
    stream.write(input)
  }
  stream.end()
  await ended
  return Buffer.concat(chunks)
}

describe('createCommunityDumpCompressStream', () => {
  test('streams a standard Zstandard frame with content checksums enabled', async () => {
    const compressed = await drainCompressStream(createCommunityDumpCompressStream(), [
      sampleJsonLines,
    ])

    expect(compressed.subarray(0, 4)).toEqual(Buffer.from([0x28, 0xb5, 0x2f, 0xfd]))
    expect(hasZstdContentChecksum(compressed)).toBe(true)
  })

  test('round-trips through decompression back to the exact original bytes', async () => {
    const compressed = await drainCompressStream(createCommunityDumpCompressStream(), [
      sampleJsonLines,
    ])

    expect(Buffer.compare(decompressCommunityDumpBuffer(compressed), sampleJsonLines)).toBe(0)
  })

  test('reassembles many small incremental writes into one valid frame', async () => {
    const rowLines = Array.from(
      { length: 50 },
      (_, index) => JSON.stringify({ observationId: String(index) }) + '\n',
    )
    const inputs = rowLines.map((line) => Buffer.from(line, 'utf8'))
    const expected = Buffer.concat(inputs)

    const compressed = await drainCompressStream(createCommunityDumpCompressStream(), inputs)

    expect(Buffer.compare(decompressCommunityDumpBuffer(compressed), expected)).toBe(0)
    expect(hasZstdContentChecksum(compressed)).toBe(true)
  })

  test('produces byte-identical, deterministic output across separate stream instances', async () => {
    const first = await drainCompressStream(createCommunityDumpCompressStream(), [sampleJsonLines])
    const second = await drainCompressStream(createCommunityDumpCompressStream(), [
      Buffer.from(sampleJsonLines),
    ])

    expect(Buffer.compare(first, second)).toBe(0)
    expect(createHash('sha256').update(first).digest('hex')).toBe(
      createHash('sha256').update(second).digest('hex'),
    )
  })

  test('streams an empty input into a valid, round-trippable empty frame', async () => {
    const compressed = await drainCompressStream(createCommunityDumpCompressStream(), [])

    expect(hasZstdContentChecksum(compressed)).toBe(true)
    expect(decompressCommunityDumpBuffer(compressed).length).toBe(0)
  })
})
