/**
 * The nine Community Dump v1 dataset names, in the exact order declared by
 * docs/postgresql-migration-plan.md lines 665-676 (manifest `files[].dataset` union) and
 * 691-699 (per-dataset ordered key table). This is the single source of truth for dataset
 * identity; the registry, serializer, and manifest modules all key off of it.
 */
export type CommunityDumpDatasetName =
  | 'createShipObservations'
  | 'createItemObservations'
  | 'remodelItemObservations'
  | 'dropShipObservations'
  | 'passEventObservations'
  | 'battleApiObservations'
  | 'nightContactObservations'
  | 'aaciObservations'
  | 'nightBattleCiObservations'
