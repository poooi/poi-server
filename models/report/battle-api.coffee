mongoose = require 'mongoose'
Schema = mongoose.Schema

BattleAPI = new Schema
  origin: String
  path: String
  data: Object

BattleAPI.virtual('date').get ->
  this._id.getTimestamp()

mongoose.model 'BattleAPI', BattleAPI
