import { type CommunityDumpDatasetName } from './community-dump-dataset-name'
import {
  normalizeCommunityDumpJsonValue,
  type CommunityDumpJsonValue,
} from './community-dump-json-value'
import { getCommunityDumpDataset } from './community-dump-registry'
import {
  encodeIsoMillisecondTimestampUtc,
  encodeNonNegativeDecimal,
  encodeNonNegativeSafeInteger,
} from './community-dump-values'

/**
 * Community Dump v1 record serializer (plan lines 622-712). Accepts one raw PostgreSQL
 * row for a single dataset — keyed by the table's actual snake_case column names, exactly
 * as a plain `SELECT *`-style query (e.g. via `pg-query-stream`) would return it, including
 * the shared `id`/`ingested_at` columns every Observation table has — and emits one compact
 * UTF-8 JSON Lines record.
 *
 * Row values for declared payload columns are expected to already carry their target JSON
 * shape (JS `number` for integer/bigint/double columns, `string` for text, `boolean` for
 * boolean, arrays for array columns, plain objects/arrays for JSONB); this module's job is
 * name-mapping, null handling, non-finite-number rejection, and recursive JSONB key
 * ordering, not numeric coercion from the PostgreSQL wire format. The `id` column is the
 * one deliberate exception: because `pg` returns `bigint` (`int8`) columns as decimal
 * strings by default, `id` may be provided as a `number`, `bigint`, or decimal `string`.
 */

export type CommunityDumpRow = Record<string, unknown>

/** Serializes one PostgreSQL row for `dataset` into a single compact JSON line (no trailing LF). */
export const serializeCommunityDumpRecord = (
  dataset: CommunityDumpDatasetName,
  row: CommunityDumpRow,
): string => {
  const definition = getCommunityDumpDataset(dataset)

  const record: { [key: string]: CommunityDumpJsonValue } = {
    observationId: encodeNonNegativeDecimal(row.id, 'observationId'),
    ingestedAt: encodeIsoMillisecondTimestampUtc(row.ingested_at, 'ingestedAt'),
  }
  for (const fieldDefinition of definition.fields) {
    record[fieldDefinition.apiKey] =
      fieldDefinition.encoding === 'safeInteger'
        ? encodeNonNegativeSafeInteger(row[fieldDefinition.sourceColumn], fieldDefinition.apiKey)
        : normalizeCommunityDumpJsonValue(row[fieldDefinition.sourceColumn], fieldDefinition.apiKey)
  }

  return JSON.stringify(record)
}

/**
 * Encodes every row for `dataset` as UTF-8 JSON Lines content: one compact JSON object per
 * line, one LF per record (including a trailing LF after the last record), and no
 * byte-order mark. Returns an empty buffer for zero rows.
 */
export const encodeCommunityDumpJsonLines = (
  dataset: CommunityDumpDatasetName,
  rows: readonly CommunityDumpRow[],
): Buffer => {
  if (rows.length === 0) {
    return Buffer.alloc(0)
  }
  const content = rows.map((row) => serializeCommunityDumpRecord(dataset, row) + '\n').join('')
  return Buffer.from(content, 'utf8')
}
