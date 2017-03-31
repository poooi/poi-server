import mongoose from 'mongoose'

const SelectRankRecord = new mongoose.Schema({
  teitokuId: Number,
  teitokuLv: Number,
  mapareaId: Number,
  rank: Number,
  origin: String,
})

SelectRankRecord.virtual('date').get(() => {
  this._id.getTimestamp()
})

mongoose.model('SelectRankRecord', SelectRankRecord)
