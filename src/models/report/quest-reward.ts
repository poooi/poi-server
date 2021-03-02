import mongoose, { Document } from 'mongoose'

export interface QuestRewardPayload {
  questId: number
  title: string
  detail: string
  category: number
  type: number
  origin: string
  selections: [number]
  material: [number]
  bonus: any[]
  bounsCount: number
}

interface QuestReardDocument extends Document, QuestRewardPayload {
  key: string
}

const QuestRewardSchema = new mongoose.Schema<QuestReardDocument>({
  questId: Number,
  title: String,
  detail: String,
  category: Number,
  type: Number,
  origin: String,
  key: String,
  selections: [Number],
  material: [Number],
  bonus: [{}],
  bounsCount: Number,
})

export const QuestReward = mongoose.model<QuestReardDocument>('QuestReward', QuestRewardSchema)
