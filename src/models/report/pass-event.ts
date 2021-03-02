import mongoose, { Document } from 'mongoose'

export interface PassEventRecordPayload {
  teitokuId: string
  teitokuLv: number
  mapId: number
  mapLv: number
  rewards: {
    rewardType: number
    rewardId: number
    rewardCount: number
    rewardLevel: number
  }[]
  origin: string
}

interface PassEventRecordDocument extends PassEventRecordPayload, Document {}

const PassEventRecordSchema = new mongoose.Schema<PassEventRecordDocument>({
  teitokuId: String,
  teitokuLv: Number,
  mapId: Number,
  mapLv: Number,
  rewards: [
    {
      rewardType: Number,
      rewardId: Number,
      rewardCount: Number,
      rewardLevel: Number,
    },
  ],
  origin: String,
})

export const PassEventRecord = mongoose.model<PassEventRecordDocument>(
  'PassEventRecord',
  PassEventRecordSchema,
)
