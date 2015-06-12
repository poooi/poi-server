mongoose = require 'mongoose'
Schema = mongoose.Schema

EnemyInformation = new Schema
  enemyId: Number
  ship: [Number]
  lv: [Number]
  formation: Number
  totalTyku: Number
  hp: [Number]

EnemyInformation.virtual('date').get ->
  this._id.getTimestamp()

mongoose.model 'EnemyInformation', EnemyInformation
