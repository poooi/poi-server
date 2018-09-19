import mongoose from 'mongoose'

const SelectRankRecord = new mongoose.Schema({
  teitokuId: String,
  teitokuLv: Number,
  mapareaId: Number,
  rank: Number,
  origin: String,
})

SelectRankRecord.virtual('date').get(() => {
  this._id.getTimestamp()
})

mongoose.model('SelectRankRecord', SelectRankRecord)
