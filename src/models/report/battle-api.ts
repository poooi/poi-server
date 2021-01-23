import mongoose, { Document } from 'mongoose'

interface BattleAPIDocument extends Document {
  origin: string
  path: string
  data: any
}

const BattleAPI = new mongoose.Schema<BattleAPIDocument>({
  origin: String,
  path: String,
  data: Object,
})

BattleAPI.virtual('date').get(function (this: BattleAPIDocument) {
  this._id.getTimestamp()
})

mongoose.model('BattleAPI', BattleAPI)
