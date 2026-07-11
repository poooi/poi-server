/**
 * Raised when Community Dump input (a PostgreSQL row, a manifest input, or a compressed
 * object) fails the exact validation rules described in
 * docs/postgresql-migration-plan.md lines 622-712.
 */
export class CommunityDumpError extends Error {}
