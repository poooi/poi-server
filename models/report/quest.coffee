mongoose = require 'mongoose'
Schema = mongoose.Schema

Quest = new Schema
  questId: Number
  title: String
  detail: String
  category: Number
  type: Number
  origin: String

Quest.virtual('date').get ->
  this._id.getTimestamp()

mongoose.model 'Quest', Quest
