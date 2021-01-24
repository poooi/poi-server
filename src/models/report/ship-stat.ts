import mongoose, { Document } from 'mongoose'

export interface ShipStatPayload {
  id: number
  lv: number
  los: number
  los_max: number
  asw: number
  asw_max: number
  evasion: number
  evasion_max: number
  last_timestamp: number
  count: number
}

// FIXME: ship stat id type overrides document's
type ShipStatDocument = Document & ShipStatPayload

const ShipStatSchema = new mongoose.Schema<ShipStatDocument>({
  id: Number,
  lv: Number,
  los: Number,
  los_max: Number,
  asw: Number,
  asw_max: Number,
  evasion: Number,
  evasion_max: Number,
  last_timestamp: Number,
  count: Number,
})

export const ShipStat = mongoose.model<ShipStatDocument>('ShipStat', ShipStatSchema)
