import mongoose from 'mongoose'

const MapInfo = new mongoose.Schema({
  mapId: Number,
  mapLv: Number,
  mapGaugeType: Number,
  mapGaugeNum: Number,
  teitokuLv: Number,
  mapHP: Number,
  count: Number,
})

mongoose.model('MapInfo', MapInfo)
