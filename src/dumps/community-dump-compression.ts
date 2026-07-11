import { createHash } from 'crypto'

import { Compressor, Decompressor } from 'zstd-napi'

/**
 * Community Dump v1 compression seam (plan lines 709-711). Single-pass Zstandard
 * compression at level 9 with the frame content checksum enabled and no dictionary
 * (`Compressor#loadDictionary` is intentionally never called). Streaming compression for
 * the eventual publisher is a later seam; this module only needs to produce and verify one
 * in-memory compressed buffer at a time.
 */

export interface CommunityDumpCompressedObject {
  readonly compressed: Buffer
  readonly sha256: string
  readonly compressedBytes: string
}

const ZSTD_MAGIC_NUMBER = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const CONTENT_CHECKSUM_FLAG_BIT = 0x04

/** Compresses `data` into a standard Zstandard frame (level 9, checksum enabled). */
export const compressCommunityDumpBuffer = (data: Buffer): CommunityDumpCompressedObject => {
  const compressor = new Compressor()
  compressor.setParameters({ compressionLevel: 9, checksumFlag: true })
  const compressed = compressor.compress(data)

  return {
    compressed,
    sha256: createHash('sha256').update(compressed).digest('hex'),
    compressedBytes: compressed.length.toString(),
  }
}

/** Decompresses a Zstandard frame produced by {@link compressCommunityDumpBuffer}. */
export const decompressCommunityDumpBuffer = (compressed: Buffer): Buffer => {
  const decompressor = new Decompressor()
  return decompressor.decompress(compressed)
}

/**
 * Inspects the Zstandard frame header to confirm the frame both has the expected magic
 * number and has its content checksum flag set, without decompressing the payload.
 */
export const hasZstdContentChecksum = (compressed: Buffer): boolean => {
  if (compressed.length < 5) {
    return false
  }
  if (!compressed.subarray(0, 4).equals(ZSTD_MAGIC_NUMBER)) {
    return false
  }
  const frameHeaderDescriptor = compressed[4]
  return (frameHeaderDescriptor & CONTENT_CHECKSUM_FLAG_BIT) !== 0
}
