mongoose = require 'mongoose'
Schema = mongoose.Schema

CreateShipRecord = new Schema
  items: [Number]
  kdockId: Number
  secretary: Number
  shipId: Number
  highspeed: Number
  large: Boolean

CreateShipRecord.virtual('date').get ->
  this._id.getTimestamp()

mongoose.model 'CreateShipRecord', CreateShipRecord
