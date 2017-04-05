import mongoose from 'mongoose'

const RecipeUpgradeRecord = new mongoose.Schema({
  recipeId: Number,
  upgradeToItemId: Number,
  upgradeToItemLevel: Number,
  day: Number,
  secretary: Number,
  origin: String,
})

RecipeUpgradeRecord.virtual('date').get(() => {
  this._id.getTimestamp()
})

mongoose.model('RecipeUpgradeRecord', RecipeUpgradeRecord)
