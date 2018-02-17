import mongoose from 'mongoose'

const ShipStat = new mongoose.Schema({
  id: Number,
  lv: Number,
  los: Number,
  los_max: Number,
  asw: Number,
  asw_max: Number,
  evasion: Number,
  evasion_max: Number,
  origin: String,
})

mongoose.model('ShipStat', ShipStat)
