import mongoose from 'mongoose'

const CreateItemRecord = new mongoose.Schema({
  items: [Number],
  secretary: Number,
  itemId: Number,
  teitokuLv: Number,
  successful: Boolean,
  origin: String,
})

CreateItemRecord.virtual('date').get(() => {
  this._id.getTimestamp()
})

mongoose.model('CreateItemRecord', CreateItemRecord)
