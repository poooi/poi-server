import mongoose, { Document } from 'mongoose'

export interface QuestPayload {
  questId: number
  title: string
  detail: string
  category: number
  type: number
  origin: string
}

interface QuestPayloadDocument extends Document, QuestPayload {
  key: string
}

const QuestSchema = new mongoose.Schema<QuestPayloadDocument>({
  questId: Number,
  title: String,
  detail: String,
  category: Number,
  type: Number,
  origin: String,
  key: String,
})

QuestSchema.virtual('date').get(function (this: QuestPayloadDocument) {
  this._id.getTimestamp()
})

export const Quest = mongoose.model<QuestPayloadDocument>('Quest', QuestSchema)
