/**
 * Errors raised by the Community Dump monthly partition maintenance/repair seam
 * (docs/postgresql-migration-plan.md lines 713-739). `PartitionCatalogMismatchError` is the
 * specific subtype raised when PostgreSQL catalog inspection proves a relation is missing, is
 * the DEFAULT partition, is attached to the wrong parent, or does not have the exact expected
 * JST Dump Month bounds; every other actionable failure (invalid Dump Month text, a table
 * outside the nine-table allowlist, an unsafe SQL identifier, or a row-count mismatch while
 * moving rows) raises the base `PartitionMaintenanceError`.
 */
export class PartitionMaintenanceError extends Error {}

export class PartitionCatalogMismatchError extends PartitionMaintenanceError {}
