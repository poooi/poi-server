import { communityDumpDatasets } from '../../../dumps/community-dump-registry'
import { PartitionMaintenanceError } from './errors'

/**
 * The nine Observation parent/default tables eligible for monthly partition maintenance
 * (docs/postgresql-migration-plan.md lines 713-739). Derived directly from
 * `communityDumpDatasets` so this allowlist can never drift from the Community Dump registry
 * that already enumerates exactly these nine PostgreSQL table names
 * (src/dumps/community-dump-registry.ts). No other identifier is ever accepted for the
 * create-upcoming-month or repair commands; every SQL statement built by this seam interpolates
 * a table name only after it has passed `assertObservationParentTable`.
 */
export const observationParentTables: readonly string[] = communityDumpDatasets.map(
  (definition) => definition.table,
)

const observationParentTableSet = new Set<string>(observationParentTables)

export const isObservationParentTable = (table: string): boolean =>
  observationParentTableSet.has(table)

export const assertObservationParentTable = (table: string): void => {
  if (!isObservationParentTable(table)) {
    throw new PartitionMaintenanceError(
      `"${table}" is not one of the nine allowlisted Observation parent tables: ` +
        observationParentTables.join(', '),
    )
  }
}
