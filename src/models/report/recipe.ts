import mongoose, { Document } from 'mongoose'

export interface RecipeRecordPayload {
  recipeId: number
  itemId: number
  stage: number
  day: number
  secretary: number
  fuel: number
  ammo: number
  steel: number
  bauxite: number
  reqItemId: number
  reqItemCount: number
  buildkit: number
  remodelkit: number
  certainBuildkit: number
  certainRemodelkit: number
  upgradeToItemId: number
  upgradeToItemLevel: number
  lastReported: number
  count: number
  key: string
  origin: string
}

interface RecipeRecordDocument extends Document, RecipeRecordPayload {}

const RecipeRecordSchema = new mongoose.Schema<RecipeRecordDocument>({
  recipeId: Number,
  itemId: Number,
  stage: Number,
  day: Number,
  secretary: Number,
  fuel: Number,
  ammo: Number,
  steel: Number,
  bauxite: Number,
  reqItemId: Number,
  reqItemCount: Number,
  buildkit: Number,
  remodelkit: Number,
  certainBuildkit: Number,
  certainRemodelkit: Number,
  upgradeToItemId: Number,
  upgradeToItemLevel: Number,
  lastReported: Number,
  count: Number,
  key: String,
  origin: String,
})

RecipeRecordSchema.virtual('date').get(function (this: RecipeRecordDocument) {
  this._id.getTimestamp()
})

export const RecipeRecord = mongoose.model('RecipeRecord', RecipeRecordSchema)
