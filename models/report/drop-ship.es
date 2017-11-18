import mongoose from 'mongoose'

const DropShipRecord = new mongoose.Schema({
  shipId: Number,
  itemId: Number,
  mapId: Number,
  quest: String,
  cellId: Number,
  enemy: String,
  rank: String,
  isBoss: Boolean,
  teitokuLv: Number,
  mapLv: Number,
  enemyShips1: [Number],
  enemyShips2: [Number],
  enemyFormation: Number,
  origin: String,
})

DropShipRecord.virtual('date').get(() => {
  this._id.getTimestamp()
})

mongoose.model('DropShipRecord', DropShipRecord)
