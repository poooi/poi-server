/**
 * Errors raised by the Community Dump publish/cleanup workflow
 * (docs/postgresql-migration-plan.md lines 622-811). Mirrors the style of
 * `db/postgres/partitions/errors.ts`: a narrow base class plus one subtype per distinct
 * actionable failure category, so callers (CLI scripts, `data_dump_runs.error` persistence) can
 * branch on error identity when useful, while every message on its own is already actionable.
 *
 * Two failure categories already have a natural home elsewhere and are deliberately NOT
 * duplicated here:
 *  - `PartitionCatalogMismatchError` (db/postgres/partitions/errors.ts) — raised directly by
 *    `assertExactMonthlyPartitionBounds` when catalog inspection disproves a partition; both
 *    publish's export phase and cleanup's re-proof phase let it propagate unchanged.
 *  - `ObjectNotFoundError` / `ObjectVerificationError` (object-store/object-store.ts) — raised
 *    directly by `putImmutableAndVerify`/`getObject` for byte-level object mismatches; both
 *    workflows let those propagate unchanged too.
 */
export class CommunityDumpWorkflowError extends Error {}

/**
 * Raised when a precondition required before starting or continuing publish/cleanup is not met,
 * and nothing has been changed as a result. Examples: the requested Dump Month is not yet closed
 * (open/current/future JST month); the database schema is incompatible; a default Observation
 * partition already holds rows for the target month; the
 * referenced `data_dump_runs` row does not exist or is not in a status that allows the requested
 * operation; cleanup was requested before `cleanup_eligible_at`.
 */
export class CommunityDumpPreconditionError extends CommunityDumpWorkflowError {}

/**
 * Raised when a higher-level cross-check (not a single object's raw bytes, which is
 * `ObjectVerificationError`'s job) proves a mismatch: the manifest's parsed dataset/schema set
 * does not exactly match the nine `data_dump_files` rows recorded for the run, or a recorded
 * `data_dump_files` entry does not match what the run expects to find there. Nothing is changed
 * when this is raised.
 */
export class CommunityDumpVerificationMismatchError extends CommunityDumpWorkflowError {}
