mongoose = require 'mongoose'
Schema = mongoose.Schema

DropShipRecord = new Schema
  shipId: Number
  itemId: Number
  mapId: Number
  quest: String
  cellId: Number
  enemy: String
  rank: String
  isBoss: Boolean
  teitokuLv: Number
  mapLv: Number
  enemyShips: [Number]
  enemyFormation: Number
  origin: String

DropShipRecord.virtual('date').get ->
  this._id.getTimestamp()

mongoose.model 'DropShipRecord', DropShipRecord
