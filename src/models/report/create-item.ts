import mongoose, { Document } from 'mongoose'

export interface CreateItemRecordPayload {
  items: number[]
  secretary: number
  itemId: number
  teitokuLv: number
  successful: boolean
  origin: string
}

interface CreateItemRecordDocument extends Document, CreateItemRecordPayload {}

const CreateItemRecordSchema = new mongoose.Schema<CreateItemRecordDocument>({
  items: [Number],
  secretary: Number,
  itemId: Number,
  teitokuLv: Number,
  successful: Boolean,
  origin: String,
})

CreateItemRecordSchema.virtual('date').get(function (this: CreateItemRecordDocument) {
  this._id.getTimestamp()
})

export const CreateItemRecord = mongoose.model<CreateItemRecordDocument>(
  'CreateItemRecord',
  CreateItemRecordSchema,
)
