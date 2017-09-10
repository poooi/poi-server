import mongoose from 'mongoose'

const AACIRecord = new mongoose.Schema({
  poiVersion: String,
  available: [Number],
  triggered: Number,
  items: [Number],
  improvement: [Number],
  rawLuck: Number,
  rawTaiku: Number,
  lv: Number,
  origin: String,
})

AACIRecord.virtual('date').get(() => {
  this._id.getTimestamp()
})

mongoose.model('AACIRecord', AACIRecord)
