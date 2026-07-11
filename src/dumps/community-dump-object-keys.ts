import { type CommunityDumpDatasetName } from './community-dump-dataset-name'
import { CommunityDumpError } from './community-dump-errors'

/**
 * Deterministic Community Dump v1 object key derivation
 * (docs/postgresql-migration-plan.md lines 646-651):
 *
 *   months/{YYYY-MM}/v{schemaVersion}/{dataset}.jsonl.zst
 *   months/{YYYY-MM}/v{schemaVersion}/manifest.json
 *
 * Deliberately backend-neutral (no PostgreSQL import), matching every other module in this
 * directory: the R2/S3 key layout is the same regardless of which database produced the data.
 * `dumpMonth` format validation mirrors the identical check already independently duplicated by
 * `community-dump-manifest.ts` and `db/postgres/partitions/dump-month.ts` — each of those lives
 * in a different architectural layer that must not depend on the others, so this is the third,
 * equally-independent copy of the same one-line YYYY-MM regex, not a reimplementation of any
 * larger module's logic.
 */

export const communityDumpDataObjectSchemaVersion = 1 as const

const dumpMonthPattern = /^\d{4}-(0[1-9]|1[0-2])$/

const assertValidDumpMonth = (dumpMonth: string): void => {
  if (!dumpMonthPattern.test(dumpMonth)) {
    throw new CommunityDumpError(`dumpMonth: expected a YYYY-MM string, got "${dumpMonth}"`)
  }
}

/** Object key for one dataset's compressed JSON Lines data file for one Dump Month. */
export const deriveCommunityDumpDataObjectKey = (
  dumpMonth: string,
  dataset: CommunityDumpDatasetName,
): string => {
  assertValidDumpMonth(dumpMonth)
  return `months/${dumpMonth}/v${communityDumpDataObjectSchemaVersion}/${dataset}.jsonl.zst`
}

/** Object key for one Dump Month's manifest (uncompressed JSON; the publication commit point). */
export const deriveCommunityDumpManifestObjectKey = (dumpMonth: string): string => {
  assertValidDumpMonth(dumpMonth)
  return `months/${dumpMonth}/v${communityDumpDataObjectSchemaVersion}/manifest.json`
}
