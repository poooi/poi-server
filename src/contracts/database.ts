import { z } from 'zod'

export const estimatedCountsSchema = z.object({
  createShipObservations: z.number(),
  createItemObservations: z.number(),
  remodelItemObservations: z.number(),
  dropShipObservations: z.number(),
  passEventObservations: z.number(),
  battleApiObservations: z.number(),
  nightContactObservations: z.number(),
  aaciObservations: z.number(),
  nightBattleCiObservations: z.number(),
  selectRankStates: z.number(),
  recipeAggregates: z.number(),
  shipStatAggregates: z.number(),
  enemyInfoAggregates: z.number(),
  questDefinitions: z.number(),
  questRewardDefinitions: z.number(),
  itemImprovementAvailabilityFacts: z.number(),
  itemImprovementCostFacts: z.number(),
  itemImprovementUpdateFacts: z.number(),
})

export const databaseStatusSchema = z.object({
  backend: z.enum(['mongodb', 'postgresql']),
  status: z.literal('up'),
  estimatedCounts: estimatedCountsSchema,
})

export type DatabaseStatus = z.infer<typeof databaseStatusSchema>
