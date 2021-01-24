import mongoose, { Document } from 'mongoose'

export interface NightContactRecordPayload {
  fleetType: number
  shipId: number
  shipLv: number
  itemId: number
  itemLv: number
  contact: boolean
}

interface NightContactRecordDocument extends NightContactRecordPayload, Document {}

const NightContactRecordSchema = new mongoose.Schema<NightContactRecordDocument>({
  fleetType: Number,
  shipId: Number,
  shipLv: Number,
  itemId: Number,
  itemLv: Number,
  contact: Boolean,
})

NightContactRecordSchema.virtual('date').get(function (this: NightContactRecordDocument) {
  this._id.getTimestamp()
})

export const NightContactRecord = mongoose.model<NightContactRecordDocument>(
  'NightContactRecord',
  NightContactRecordSchema,
)
