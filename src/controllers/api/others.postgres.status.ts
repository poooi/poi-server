import { sql } from 'drizzle-orm'
import { type NodePgDatabase } from 'drizzle-orm/node-postgres'

import { type DatabaseStatus } from '../../contracts/database'
import type * as schema from '../../db/postgres/schema'

type PostgresDb = NodePgDatabase<typeof schema>

// Maps every `/api/status.database.estimatedCounts` key to its backing PostgreSQL table name.
const DATASET_TABLES: ReadonlyArray<readonly [dataset: string, tableName: string]> = [
  ['createShipObservations', 'create_ship_records'],
  ['createItemObservations', 'create_item_records'],
  ['remodelItemObservations', 'remodel_item_records'],
  ['dropShipObservations', 'drop_ship_records'],
  ['passEventObservations', 'pass_event_records'],
  ['battleApiObservations', 'battle_apis'],
  ['nightContactObservations', 'night_contacts'],
  ['aaciObservations', 'aaci_records'],
  ['nightBattleCiObservations', 'night_battle_cis'],
  ['selectRankStates', 'select_rank_records'],
  ['recipeAggregates', 'recipe_records'],
  ['shipStatAggregates', 'ship_stats'],
  ['enemyInfoAggregates', 'enemy_infos'],
  ['questDefinitions', 'quests'],
  ['questRewardDefinitions', 'quest_rewards'],
  ['itemImprovementAvailabilityFacts', 'item_improvement_availability_facts'],
  ['itemImprovementCostFacts', 'item_improvement_cost_facts'],
  ['itemImprovementUpdateFacts', 'item_improvement_update_facts'],
]

interface DatasetEstimateRow {
  [key: string]: unknown
  dataset: string
  estimate: number | string
}

// One catalog/planner query for every dataset. For a partitioned Observation parent (`relkind =
// 'p'`), `pg_inherits` resolves its leaf partitions and their estimates are summed; for a plain
// table there are no matching `pg_inherits` rows, so `coalesce(inhrelid, p.oid)` falls back to the
// table's own row, giving its own `reltuples` estimate. Missing tables and negative planner
// estimates (which PostgreSQL uses to mean "never analyzed") are both clamped to zero.
const buildEstimateQuery = () => {
  const datasetRows = DATASET_TABLES.map(([dataset, tableName]) => sql`(${dataset}, ${tableName})`)
  const datasetsValues = sql.join(datasetRows, sql`, `)

  return sql<DatasetEstimateRow[]>`
    with datasets (dataset, table_name) as (
      values ${datasetsValues}
    ),
    leaves as (
      select
        d.dataset,
        greatest(c.reltuples, 0) as reltuples
      from datasets d
      join pg_class p on p.relname = d.table_name and p.relkind in ('r', 'p')
      join pg_namespace n on n.oid = p.relnamespace and n.nspname = current_schema()
      left join pg_inherits i on i.inhparent = p.oid
      join pg_class c on c.oid = coalesce(i.inhrelid, p.oid) and c.relkind = 'r'
    )
    select d.dataset, coalesce(sum(l.reltuples), 0) as estimate
    from datasets d
    left join leaves l on l.dataset = d.dataset
    group by d.dataset
  `
}

const toClampedCount = (estimate: number | string): number =>
  Math.max(0, Math.round(Number(estimate)))

export const createPostgresDatabaseStatus =
  (db: PostgresDb): (() => Promise<DatabaseStatus>) =>
  async () => {
    const { rows } = await db.execute<DatasetEstimateRow>(buildEstimateQuery())
    const estimateByDataset = new Map(rows.map((row) => [row.dataset, row.estimate]))

    const estimatedCounts = Object.fromEntries(
      DATASET_TABLES.map(([dataset]) => [
        dataset,
        toClampedCount(estimateByDataset.get(dataset) ?? 0),
      ]),
    ) as DatabaseStatus['estimatedCounts']

    return {
      backend: 'postgresql',
      status: 'up',
      estimatedCounts,
    }
  }
