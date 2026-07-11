import { CommunityDumpError } from './community-dump-errors'

/**
 * Shared value encoders for the Community Dump v1 seam (plan lines 622-712). These enforce
 * the two cross-cutting rules that apply to both individual dump records and the manifest:
 *
 * - `observationId`, `rowCount`, and `compressedBytes` must be non-negative integers,
 *   encoded as decimal strings so 64-bit values never lose precision in JSON (plan
 *   lines 631-632, 684).
 * - `ingestedAt` and `publishedAt` must be valid instants, encoded as
 *   UTC ISO-8601 timestamps with millisecond precision (plan lines 631-632, 653-664).
 */

const decimalPattern = /^(0|[1-9][0-9]*)$/

/** Encodes a non-negative integer (`number`, `bigint`, or decimal `string`) as a decimal string. */
export const encodeNonNegativeDecimal = (value: unknown, fieldName: string): string => {
  if (typeof value === 'bigint') {
    if (value < BigInt(0)) {
      throw new CommunityDumpError(`${fieldName}: expected a non-negative integer`)
    }

    return value.toString()
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new CommunityDumpError(`${fieldName}: expected a finite number`)
    }
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new CommunityDumpError(`${fieldName}: expected a non-negative safe integer`)
    }
    return value.toString()
  }
  if (typeof value === 'string' && decimalPattern.test(value)) {
    return value
  }
  throw new CommunityDumpError(
    `${fieldName}: expected a non-negative integer, bigint, or decimal string`,
  )
}

export const encodeNonNegativeSafeInteger = (value: unknown, fieldName: string): number => {
  const decimal = encodeNonNegativeDecimal(value, fieldName)
  const integer = BigInt(decimal)
  if (integer > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new CommunityDumpError(`${fieldName}: expected a non-negative safe integer`)
  }
  return Number(integer)
}

/**
 * Like {@link encodeNonNegativeSafeInteger}, but first maps SQL null (and the equivalent
 * `undefined` for an omitted/missing column) to JSON `null`, exactly like every other Community
 * Dump field already does via `normalizeCommunityDumpJsonValue`. `night_battle_cis.time`
 * (the only registry field using the `'safeInteger'` encoding, see
 * `dumps/community-dump-registry.ts`) is a nullable PostgreSQL column — the report payload's
 * `time` field is optional (`contracts/v2-report.ts`) — so a real row can legitimately have no
 * `time` value; without this, `serializeCommunityDumpRecord` would throw for such a row and
 * abort the entire monthly export instead of emitting `"time":null`.
 */
export const encodeNullableSafeInteger = (value: unknown, fieldName: string): number | null => {
  if (value === null || value === undefined) {
    return null
  }
  return encodeNonNegativeSafeInteger(value, fieldName)
}

/** Encodes a `Date`, ISO-8601 string, or epoch-millisecond number as a UTC ISO-8601 timestamp. */
export const encodeIsoMillisecondTimestampUtc = (value: unknown, fieldName: string): string => {
  let date: Date
  if (value instanceof Date) {
    date = value
  } else if (typeof value === 'string' || typeof value === 'number') {
    date = new Date(value)
  } else {
    throw new CommunityDumpError(`${fieldName}: expected a Date, ISO-8601 string, or number`)
  }
  if (!Number.isFinite(date.getTime())) {
    throw new CommunityDumpError(`${fieldName}: expected a valid timestamp`)
  }
  return date.toISOString()
}
