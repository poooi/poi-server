import mongoose from 'mongoose'

const PassEventRecord = new mongoose.Schema({
  teitokuId: String,
  teitokuLv: Number,
  mapId: Number,
  mapLv: Number,
  rewards: [{ rewardType: Number, rewardId: Number, rewardCount: Number }],
  origin: String,
})

PassEventRecord.virtual('date').get(() => {
  this._id.getTimestamp()
})

mongoose.model('PassEventRecord', PassEventRecord)
