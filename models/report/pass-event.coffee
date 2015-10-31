mongoose = require 'mongoose'
Schema = mongoose.Schema

PassEventRecord = new Schema
  teitoku: String
  teitokuId: Number
  teitokuLv: Number
  mapId: Number
  mapLv: Number
  origin: String

PassEventRecord.virtual('date').get ->
  this._id.getTimestamp()

mongoose.model 'PassEventRecord', PassEventRecord
