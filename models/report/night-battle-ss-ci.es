import mongoose from 'mongoose'

const NightBattleSSCI = new mongoose.Schema({
  shipId: Number,
  CI: String,
  lv: Number,
  rawLuck: Number,
  pos: Number,
  status: String,
  items: [Number],
  improvement: [Number],
  searchLight: Boolean,
  flare: Number,
  defenseId: Number,
  defenseTypeId: Number,
  ciType: Number,
  display: [Number],
  hitType: [Number],
  damage: [Number],
  damageTotal: Number,
  time: Number,
  origin: String,
})

NightBattleSSCI.virtual('date').get(() => {
  this._id.getTimestamp()
})

mongoose.model('NightBattleSSCI', NightBattleSSCI)
