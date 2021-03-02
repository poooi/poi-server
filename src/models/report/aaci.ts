import mongoose, { Document } from 'mongoose'

interface AACIRecordDocument extends Document {
  poiVersion: string
  available: number[]
  triggered: number
  items: number[]
  improvement: number[]
  rawLuck: number
  rawTaiku: number
  lv: number
  hpPercent: number
  pos: number
  origin: string
}

export interface AACIRecordPayload {
  poiVersion: AACIRecordDocument['poiVersion']
  available: AACIRecordDocument['available']
  triggered: AACIRecordDocument['triggered']
  items: AACIRecordDocument['items']
  improvement: AACIRecordDocument['improvement']
  rawLuck: AACIRecordDocument['rawLuck']
  rawTaiku: AACIRecordDocument['rawTaiku']
  lv: AACIRecordDocument['lv']
  hpPercent: AACIRecordDocument['hpPercent']
  pos: AACIRecordDocument['pos']
  origin: AACIRecordDocument['origin']
}

const AACIRecordSchema = new mongoose.Schema<AACIRecordDocument>({
  poiVersion: String,
  available: [Number],
  triggered: Number,
  items: [Number],
  improvement: [Number],
  rawLuck: Number,
  rawTaiku: Number,
  lv: Number,
  hpPercent: Number,
  pos: Number,
  origin: String,
})

export const AACIRecord = mongoose.model<AACIRecordDocument>('AACIRecord', AACIRecordSchema)
