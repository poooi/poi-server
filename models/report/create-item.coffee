mongoose = require 'mongoose'
Schema = mongoose.Schema

CreateItemRecord = new Schema
  items: [Number]
  secretary: Number
  itemId: Number
  teitokuLv: Number
  successful: Boolean

CreateItemRecord.virtual('date').get ->
  this._id.getTimestamp()

mongoose.model 'CreateItemRecord', CreateItemRecord
