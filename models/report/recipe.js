import mongoose from 'mongoose'

const RecipeRecord = new mongoose.Schema({
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

RecipeRecord.virtual('date').get(() => {
  this._id.getTimestamp()
})

mongoose.model('RecipeRecord', RecipeRecord)
