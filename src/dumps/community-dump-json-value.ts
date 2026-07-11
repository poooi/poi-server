import { CommunityDumpError } from './community-dump-errors'

/**
 * Recursive JSON normalization shared by every Community Dump v1 payload value (plan
 * lines 703-707): SQL null (and a JS `undefined`, which behaves identically for an
 * omitted/missing column) serializes as JSON `null`; arrays preserve their element order;
 * JSONB object keys are sorted lexicographically at every nesting level; and any
 * non-finite number (`NaN`/`Infinity`/`-Infinity`), anywhere in the value including nested
 * inside arrays/objects, is rejected before persistence.
 */

export type CommunityDumpJsonValue =
  | null
  | boolean
  | number
  | string
  | CommunityDumpJsonValue[]
  | { [key: string]: CommunityDumpJsonValue }

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const normalizeCommunityDumpJsonValue = (
  value: unknown,
  path: string,
): CommunityDumpJsonValue => {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new CommunityDumpError(`${path}: expected a finite number`)
    }
    return value
  }
  if (typeof value === 'boolean' || typeof value === 'string') {
    return value
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => normalizeCommunityDumpJsonValue(item, `${path}[${index}]`))
  }
  if (isPlainObject(value)) {
    const sortedKeys = Object.keys(value).sort()
    const normalized: { [key: string]: CommunityDumpJsonValue } = {}
    for (const key of sortedKeys) {
      normalized[key] = normalizeCommunityDumpJsonValue(value[key], `${path}.${key}`)
    }
    return normalized
  }
  throw new CommunityDumpError(
    `${path}: unsupported JSON value type; convert to a number, string, boolean, array, or plain object before serialization`,
  )
}
