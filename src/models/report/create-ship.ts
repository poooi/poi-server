import mongoose, { Document } from 'mongoose'

export interface CreateShipRecordPayload {
  items: number[]
  kdockId: number
  secretary: number
  shipId: number
  highspeed: number
  teitokuLv: number
  largeFlag: boolean
  origin: string
}

interface CreateShipRecordDocument extends Document, CreateShipRecordPayload {}

const CreateShipRecordSchema = new mongoose.Schema<CreateShipRecordDocument>({
  items: [Number],
  kdockId: Number,
  secretary: Number,
  shipId: Number,
  highspeed: Number,
  teitokuLv: Number,
  largeFlag: Boolean,
  origin: String,
})

export const CreateShipRecord = mongoose.model<CreateShipRecordDocument>(
  'CreateShipRecord',
  CreateShipRecordSchema,
)
