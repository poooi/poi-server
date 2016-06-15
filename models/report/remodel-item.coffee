mongoose = require 'mongoose'
Schema = mongoose.Schema

RemodelItemRecord = new Schema
  successful: Boolean
  itemId: Number
  itemLevel: Number
  flagshipId: Number
  flagshipLevel: Number
  flagshipCond: Number
  consortId: Number
  consortLevel: Number
  consortCond: Number
  teitokuLv: Number
  certain: Boolean

RemodelItemRecord.virtual('date').get ->
  this._id.getTimestamp()

mongoose.model 'RemodelItemRecord', RemodelItemRecord
