import mongoose, { Document } from 'mongoose'

export interface RequiredItem {
  id: number
  count: number
}

export interface ItemImprovementRecipeAvailabilityFactPayload {
  key: string
  schemaVersion: number
  recipeId: number
  itemId: number
  day: number
  firstClientObservedAt: number
  lastClientObservedAt: number
  observedSecondShipId: number
  observedFlagshipIds: number[]
  sources: string[]
  origins: string[]
  firstReported: number
  lastReported: number
  count: number
}

export interface ItemImprovementRecipeCostFactPayload {
  key: string
  schemaVersion: number
  recipeId: number
  itemId: number
  itemLevel: number
  stage: number
  day: number
  firstClientObservedAt: number
  lastClientObservedAt: number
  observedSecondShipId: number
  observedFlagshipIds: number[]
  fuel: number
  ammo: number
  steel: number
  bauxite: number
  buildkit: number
  remodelkit: number
  certainBuildkit: number
  certainRemodelkit: number
  reqSlotItems: RequiredItem[]
  reqUseItems: RequiredItem[]
  changeFlag: number
  sources: string[]
  origins: string[]
  firstReported: number
  lastReported: number
  count: number
}

export interface ItemImprovementRecipeUpdateFactPayload {
  key: string
  schemaVersion: number
  recipeId: number
  itemId: number
  itemLevel: number
  day: number
  firstClientObservedAt: number
  lastClientObservedAt: number
  observedSecondShipId: number
  observedFlagshipIds: number[]
  upgradeToItemId: number
  upgradeToItemLevel: number
  upgradeObserved: true
  sources: string[]
  origins: string[]
  firstReported: number
  lastReported: number
  count: number
}

export interface ItemImprovementRecipeAvailabilityFactDocument
  extends Document, ItemImprovementRecipeAvailabilityFactPayload {}

export interface ItemImprovementRecipeCostFactDocument
  extends Document, ItemImprovementRecipeCostFactPayload {}

export interface ItemImprovementRecipeUpdateFactDocument
  extends Document, ItemImprovementRecipeUpdateFactPayload {}

const RequiredItemSchema = new mongoose.Schema<RequiredItem>(
  {
    id: Number,
    count: Number,
  },
  { _id: false },
)

const ItemImprovementRecipeAvailabilityFactSchema =
  new mongoose.Schema<ItemImprovementRecipeAvailabilityFactDocument>({
    key: String,
    schemaVersion: Number,
    recipeId: Number,
    itemId: Number,
    day: Number,
    firstClientObservedAt: Number,
    lastClientObservedAt: Number,
    observedSecondShipId: Number,
    observedFlagshipIds: [Number],
    sources: [String],
    origins: [String],
    firstReported: Number,
    lastReported: Number,
    count: Number,
  })

ItemImprovementRecipeAvailabilityFactSchema.index({ key: 1 }, { unique: true })
ItemImprovementRecipeAvailabilityFactSchema.index({ lastReported: 1, _id: 1 })
ItemImprovementRecipeAvailabilityFactSchema.index({
  itemId: 1,
  observedSecondShipId: 1,
  day: 1,
})
ItemImprovementRecipeAvailabilityFactSchema.index({ recipeId: 1 })

const ItemImprovementRecipeCostFactSchema =
  new mongoose.Schema<ItemImprovementRecipeCostFactDocument>({
    key: String,
    schemaVersion: Number,
    recipeId: Number,
    itemId: Number,
    itemLevel: Number,
    stage: Number,
    day: Number,
    firstClientObservedAt: Number,
    lastClientObservedAt: Number,
    observedSecondShipId: Number,
    observedFlagshipIds: [Number],
    fuel: Number,
    ammo: Number,
    steel: Number,
    bauxite: Number,
    buildkit: Number,
    remodelkit: Number,
    certainBuildkit: Number,
    certainRemodelkit: Number,
    reqSlotItems: [RequiredItemSchema],
    reqUseItems: [RequiredItemSchema],
    changeFlag: Number,
    sources: [String],
    origins: [String],
    firstReported: Number,
    lastReported: Number,
    count: Number,
  })

ItemImprovementRecipeCostFactSchema.index({ key: 1 }, { unique: true })
ItemImprovementRecipeCostFactSchema.index({ lastReported: 1, _id: 1 })
ItemImprovementRecipeCostFactSchema.index({
  itemId: 1,
  observedSecondShipId: 1,
  day: 1,
  itemLevel: 1,
})
ItemImprovementRecipeCostFactSchema.index({ recipeId: 1 })

const ItemImprovementRecipeUpdateFactSchema =
  new mongoose.Schema<ItemImprovementRecipeUpdateFactDocument>({
    key: String,
    schemaVersion: Number,
    recipeId: Number,
    itemId: Number,
    itemLevel: Number,
    day: Number,
    firstClientObservedAt: Number,
    lastClientObservedAt: Number,
    observedSecondShipId: Number,
    observedFlagshipIds: [Number],
    upgradeToItemId: Number,
    upgradeToItemLevel: Number,
    upgradeObserved: Boolean,
    sources: [String],
    origins: [String],
    firstReported: Number,
    lastReported: Number,
    count: Number,
  })

ItemImprovementRecipeUpdateFactSchema.index({ key: 1 }, { unique: true })
ItemImprovementRecipeUpdateFactSchema.index({ lastReported: 1, _id: 1 })
ItemImprovementRecipeUpdateFactSchema.index({
  itemId: 1,
  observedSecondShipId: 1,
  day: 1,
  itemLevel: 1,
})
ItemImprovementRecipeUpdateFactSchema.index({ recipeId: 1 })
ItemImprovementRecipeUpdateFactSchema.index({ upgradeToItemId: 1 })

export const ItemImprovementRecipeAvailabilityFact =
  mongoose.model<ItemImprovementRecipeAvailabilityFactDocument>(
    'ItemImprovementRecipeAvailabilityFact',
    ItemImprovementRecipeAvailabilityFactSchema,
  )

export const ItemImprovementRecipeCostFact = mongoose.model<ItemImprovementRecipeCostFactDocument>(
  'ItemImprovementRecipeCostFact',
  ItemImprovementRecipeCostFactSchema,
)

export const ItemImprovementRecipeUpdateFact =
  mongoose.model<ItemImprovementRecipeUpdateFactDocument>(
    'ItemImprovementRecipeUpdateFact',
    ItemImprovementRecipeUpdateFactSchema,
  )
