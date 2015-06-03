mongoose = require 'mongoose'
Schema = mongoose.Schema

DropShipRecord = new Schema
  shipId: Number
  quest: String
  enemy: String
  rank: String

DropShipRecord.virtual('date').get ->
  this._id.getTimestamp()

mongoose.model 'DropShipRecord', DropShipRecord
