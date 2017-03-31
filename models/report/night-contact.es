import mongoose from 'mongoose'

const NightContactRecord = new mongoose.Schema({
  fleetType: Number,
  shipId: Number,
  shipLv: Number,
  itemId: Number,
  itemLv: Number,
  contact: Boolean,
})

NightContactRecord.virtual('date').get(() => {
  this._id.getTimestamp()
})

mongoose.model('NightContactRecord', NightContactRecord)
