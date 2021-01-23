import mongoose from 'mongoose'

const BattleAPI = new mongoose.Schema({
  origin: String,
  path: String,
  data: Object,
})

BattleAPI.virtual('date').get(() => {
  this._id.getTimestamp()
})

mongoose.model('BattleAPI', BattleAPI)
