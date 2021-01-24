import mongoose, { Document } from 'mongoose'

export interface NightBattleCIPayload {
  shipId: number
  CI: string
  type: string
  lv: number
  rawLuck: number
  pos: number
  status: string
  items: number[]
  improvement: number[]
  searchLight: boolean
  flare: number
  defenseId: number
  defenseTypeId: number
  ciType: number
  display: number[]
  hitType: number[]
  damage: number[]
  damageTotal: number
  time: number
  origin: string
}

interface NightBattleCIDocument extends NightBattleCIPayload, Document {}

const NightBattleCISchema = new mongoose.Schema<NightBattleCIDocument>({
  shipId: Number,
  CI: String,
  type: String,
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

NightBattleCISchema.virtual('date').get(function (this: NightBattleCIDocument) {
  this._id.getTimestamp()
})

export const NightBattleCI = mongoose.model<NightBattleCIDocument>(
  'NightBattleCI',
  NightBattleCISchema,
)
