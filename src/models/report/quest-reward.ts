import mongoose from 'mongoose'

const QuestReward = new mongoose.Schema({
  questId: Number,
  title: String,
  detail: String,
  category: Number,
  type: Number,
  origin: String,
  key: String,
  selections: [Number],
  material: [Number],
  bonus: [{}],
  bounsCount: Number,
})

QuestReward.virtual('date').get(() => {
  this._id.getTimestamp()
})

mongoose.model('QuestReward', QuestReward)
