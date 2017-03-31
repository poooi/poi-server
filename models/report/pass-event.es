import mongoose from 'mongoose'

const PassEventRecord = new mongoose.Schema({
  teitoku: String,
  teitokuId: Number,
  teitokuLv: Number,
  mapId: Number,
  mapLv: Number,
  origin: String,
})

PassEventRecord.virtual('date').get(() => {
  this._id.getTimestamp()
})

mongoose.model('PassEventRecord', PassEventRecord)
