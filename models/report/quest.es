import mongoose from 'mongoose'

const Quest = new mongoose.Schema({
  questId:  Number,
  title: String,
  detail: String,
  category: Number,
  type: Number,
  origin: String,
  key: String,
})

Quest.virtual('date').get(() => {
  this._id.getTimestamp()
})

mongoose.model('Quest', Quest)
