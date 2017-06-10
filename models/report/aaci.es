import mongoose from 'mongoose'

const AACIRecord = new mongoose.Schema({
  available: [Number],
  triggered: Number,
  origin: String,
})

AACIRecord.virtual('date').get(() => {
  this._id.getTimestamp()
})

mongoose.model('AACIRecord', AACIRecord)
