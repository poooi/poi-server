import { type CommunityDumpDatasetName } from './community-dump-dataset-name'
import { CommunityDumpError } from './community-dump-errors'
import { communityDumpDatasetNames, isCommunityDumpDatasetName } from './community-dump-registry'
import { encodeIsoMillisecondTimestampUtc, encodeNonNegativeDecimal } from './community-dump-values'

/**
 * Community Dump v1 manifest serializer (plan lines 653-685). Builds the exact
 * `CommunityDumpManifestV1` object the plan declares, always ordering `files` in registry
 * order regardless of input order so the manifest's shape is fully deterministic, and
 * rejecting any input whose dataset set is not exactly the nine expected datasets
 * (missing, duplicated, or unknown/extra dataset names all fail).
 */

export const communityDumpManifestSchemaVersion = 1 as const
export const communityDumpManifestTimezone = 'Asia/Tokyo' as const

export interface CommunityDumpManifestFileInput {
  readonly dataset: string
  readonly objectKey: string
  readonly rowCount: unknown
  readonly compressedBytes: unknown
  readonly sha256: string | Buffer
}

export interface CommunityDumpManifestInput {
  readonly epochId: string
  readonly epochStartedAt: unknown
  readonly dumpMonth: string
  readonly publishedAt: unknown
  readonly files: readonly CommunityDumpManifestFileInput[]
}

export interface CommunityDumpManifestFileV1 {
  readonly dataset: CommunityDumpDatasetName
  readonly objectKey: string
  readonly rowCount: string
  readonly compressedBytes: string
  readonly sha256: string
}

export interface CommunityDumpManifestV1 {
  readonly schemaVersion: 1
  readonly epoch: {
    readonly id: string
    readonly startedAt: string | null
  }
  readonly dumpMonth: string
  readonly timezone: 'Asia/Tokyo'
  readonly publishedAt: string
  readonly files: readonly CommunityDumpManifestFileV1[]
}

const dumpMonthPattern = /^\d{4}-(0[1-9]|1[0-2])$/
const sha256HexPattern = /^[0-9a-fA-F]{64}$/

const encodeSha256 = (value: string | Buffer): string => {
  if (Buffer.isBuffer(value)) {
    if (value.length !== 32) {
      throw new CommunityDumpError('sha256: expected exactly 32 bytes')
    }
    return value.toString('hex')
  }
  if (typeof value === 'string' && sha256HexPattern.test(value)) {
    return value.toLowerCase()
  }
  throw new CommunityDumpError('sha256: expected 32 bytes or 64 lowercase hexadecimal characters')
}

export const serializeCommunityDumpManifestV1 = (
  input: CommunityDumpManifestInput,
): CommunityDumpManifestV1 => {
  if (typeof input.epochId !== 'string' || input.epochId.length === 0) {
    throw new CommunityDumpError('epoch.id: expected a non-empty string')
  }
  if (!dumpMonthPattern.test(input.dumpMonth)) {
    throw new CommunityDumpError('dumpMonth: expected a YYYY-MM string')
  }

  const filesByDataset = new Map<CommunityDumpDatasetName, CommunityDumpManifestFileInput>()
  for (const file of input.files) {
    if (!isCommunityDumpDatasetName(file.dataset)) {
      throw new CommunityDumpError(`files: unknown dataset "${file.dataset}"`)
    }
    if (filesByDataset.has(file.dataset)) {
      throw new CommunityDumpError(`files: duplicate dataset "${file.dataset}"`)
    }
    filesByDataset.set(file.dataset, file)
  }
  for (const dataset of communityDumpDatasetNames) {
    if (!filesByDataset.has(dataset)) {
      throw new CommunityDumpError(`files: missing dataset "${dataset}"`)
    }
  }
  if (filesByDataset.size !== communityDumpDatasetNames.length) {
    throw new CommunityDumpError(
      `files: expected exactly ${communityDumpDatasetNames.length} dataset entries`,
    )
  }

  const files: CommunityDumpManifestFileV1[] = communityDumpDatasetNames.map((dataset) => {
    const file = filesByDataset.get(dataset)
    /* c8 ignore next 3 -- every dataset is guaranteed present by the completeness check above */
    if (!file) {
      throw new CommunityDumpError(`files: missing dataset "${dataset}"`)
    }
    return {
      dataset,
      objectKey: file.objectKey,
      rowCount: encodeNonNegativeDecimal(file.rowCount, `files.${dataset}.rowCount`),
      compressedBytes: encodeNonNegativeDecimal(
        file.compressedBytes,
        `files.${dataset}.compressedBytes`,
      ),
      sha256: encodeSha256(file.sha256),
    }
  })

  return {
    schemaVersion: communityDumpManifestSchemaVersion,
    epoch: {
      id: input.epochId,
      startedAt:
        input.epochStartedAt === null
          ? null
          : encodeIsoMillisecondTimestampUtc(input.epochStartedAt, 'epoch.startedAt'),
    },
    dumpMonth: input.dumpMonth,
    timezone: communityDumpManifestTimezone,
    publishedAt: encodeIsoMillisecondTimestampUtc(input.publishedAt, 'publishedAt'),
    files,
  }
}

/**
 * Untrusted-JSON manifest parser for the cleanup workflow's re-verification step (plan lines
 * 754-756: "re-verify the manifest digest and size, require its dataset set and every entry to
 * match `data_dump_files`"). Never duplicates `serializeCommunityDumpManifestV1`'s validation:
 * this function only narrows raw parsed JSON into the shape that builder already expects, then
 * delegates every semantic check (dataset completeness/uniqueness, decimal encoding, SHA-256
 * hex format, timestamp validity) to it, so parsing a manifest and building one share exactly
 * one source of truth for what "valid" means.
 */
function assertJsonObject(value: unknown, path: string): asserts value is object {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CommunityDumpError(`${path}: expected a JSON object`)
  }
}

function assertHasKey<K extends string>(
  value: object,
  key: K,
  path: string,
): asserts value is { [P in K]: unknown } {
  if (!(key in value)) {
    throw new CommunityDumpError(`${path}.${key}: missing`)
  }
}

function assertIsString(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string') {
    throw new CommunityDumpError(`${path}: expected a string`)
  }
}

const parseManifestFileInput = (value: unknown, index: number): CommunityDumpManifestFileInput => {
  const path = `files[${index}]`
  assertJsonObject(value, path)
  assertHasKey(value, 'dataset', path)
  assertIsString(value.dataset, `${path}.dataset`)
  assertHasKey(value, 'objectKey', path)
  assertIsString(value.objectKey, `${path}.objectKey`)
  assertHasKey(value, 'rowCount', path)
  assertHasKey(value, 'compressedBytes', path)
  assertHasKey(value, 'sha256', path)
  assertIsString(value.sha256, `${path}.sha256`)
  return {
    dataset: value.dataset,
    objectKey: value.objectKey,
    rowCount: value.rowCount,
    compressedBytes: value.compressedBytes,
    sha256: value.sha256,
  }
}

/** Parses and fully re-validates raw manifest bytes read back from the object store. */
export const parseCommunityDumpManifestV1 = (rawBytes: Buffer): CommunityDumpManifestV1 => {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawBytes.toString('utf8'))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new CommunityDumpError(`manifest: invalid JSON (${message})`)
  }

  assertJsonObject(parsed, 'manifest')
  assertHasKey(parsed, 'epoch', 'manifest')
  assertJsonObject(parsed.epoch, 'manifest.epoch')
  assertHasKey(parsed.epoch, 'id', 'manifest.epoch')
  assertIsString(parsed.epoch.id, 'manifest.epoch.id')
  assertHasKey(parsed.epoch, 'startedAt', 'manifest.epoch')

  assertHasKey(parsed, 'dumpMonth', 'manifest')
  assertIsString(parsed.dumpMonth, 'manifest.dumpMonth')

  assertHasKey(parsed, 'publishedAt', 'manifest')

  assertHasKey(parsed, 'files', 'manifest')
  if (!Array.isArray(parsed.files)) {
    throw new CommunityDumpError('manifest.files: expected an array')
  }

  const manifest = serializeCommunityDumpManifestV1({
    epochId: parsed.epoch.id,
    epochStartedAt: parsed.epoch.startedAt,
    dumpMonth: parsed.dumpMonth,
    publishedAt: parsed.publishedAt,
    files: parsed.files.map((file: unknown, index: number) => parseManifestFileInput(file, index)),
  })
  assertHasKey(parsed, 'schemaVersion', 'manifest')
  if (parsed.schemaVersion !== communityDumpManifestSchemaVersion) {
    throw new CommunityDumpError(
      `manifest.schemaVersion: expected ${communityDumpManifestSchemaVersion}`,
    )
  }
  assertHasKey(parsed, 'timezone', 'manifest')
  if (parsed.timezone !== communityDumpManifestTimezone) {
    throw new CommunityDumpError(`manifest.timezone: expected "${communityDumpManifestTimezone}"`)
  }
  return manifest
}
