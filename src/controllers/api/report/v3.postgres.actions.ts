import { type AppResult } from '../../../http/result'
import { type ReportV3Actions } from './v3.fastify'

// PostgreSQL v3 item-improvement/quest actions are not implemented yet (see
// docs/postgresql-migration-plan.md, "v3 item-improvement compatibility": explicitly out of
// scope for this phase). This module exists only so PostgreSQL startup never silently falls back
// to the MongoDB v3 action set, which would attempt to use Mongoose models against a PostgreSQL
// connection. Every action rejects with an actionable error instead of a success-shaped no-op.
export class PostgresV3UnavailableError extends Error {
  constructor(endpoint: string) {
    super(
      `PostgreSQL v3 report actions are not implemented yet (${endpoint}). ` +
        'Use the MongoDB backend for v3 report endpoints until PostgreSQL v3 support ships.',
    )
  }
}

const unavailable = (endpoint: string) => (): Promise<AppResult> =>
  Promise.reject(new PostgresV3UnavailableError(endpoint))

export const postgresV3ActionsUnavailable: ReportV3Actions = {
  itemImprovementRecipe: unavailable('POST /api/report/v3/item_improvement_recipe'),
  itemImprovementRecipeAvailability: unavailable(
    'GET /api/report/v3/item_improvement_recipes/availability',
  ),
  itemImprovementRecipeCosts: unavailable('GET /api/report/v3/item_improvement_recipes/costs'),
  itemImprovementRecipeUpdates: unavailable('GET /api/report/v3/item_improvement_recipes/updates'),
  knownQuests: unavailable('GET /api/report/v3/known_quests'),
  quest: unavailable('POST /api/report/v3/quest'),
  questReward: unavailable('POST /api/report/v3/quest_reward'),
}
