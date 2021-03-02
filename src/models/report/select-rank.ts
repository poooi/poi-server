import mongoose, { Document } from 'mongoose'

export interface SelectRankRecordPayload {
  teitokuId: string
  teitokuLv: number
  mapareaId: number
  rank: number
  origin: string
}

interface SelectRankRecordDocument extends SelectRankRecordPayload, Document {}

const SelectRankRecordSchema = new mongoose.Schema<SelectRankRecordDocument>({
  teitokuId: String,
  teitokuLv: Number,
  mapareaId: Number,
  rank: Number,
  origin: String,
})

export const SelectRankRecord = mongoose.model<SelectRankRecordDocument>(
  'SelectRankRecord',
  SelectRankRecordSchema,
)
