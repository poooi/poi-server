import mongoose, { Document } from 'mongoose'

export interface RemodelItemRecordPayload {
  successful: boolean
  itemId: number
  itemLevel: number
  flagshipId: number
  flagshipLevel: number
  flagshipCond: number
  consortId: number
  consortLevel: number
  consortCond: number
  teitokuLv: number
  certain: boolean
}

interface RemodelItemRecordDocument extends RemodelItemRecordPayload, Document {}

const RemodelItemRecordSchema = new mongoose.Schema<RemodelItemRecordDocument>({
  successful: Boolean,
  itemId: Number,
  itemLevel: Number,
  flagshipId: Number,
  flagshipLevel: Number,
  flagshipCond: Number,
  consortId: Number,
  consortLevel: Number,
  consortCond: Number,
  teitokuLv: Number,
  certain: Boolean,
})

RemodelItemRecordSchema.virtual('date').get(function (this: RemodelItemRecordDocument) {
  this._id.getTimestamp()
})

export const RemodelItemRecord = mongoose.model<RemodelItemRecordDocument>(
  'RemodelItemRecord',
  RemodelItemRecordSchema,
)
