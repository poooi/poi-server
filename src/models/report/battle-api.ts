import mongoose, { Document } from 'mongoose'

interface BattleAPIDocument extends Document {
  origin: string
  path: string
  data: any
}

export interface BattleAPIPayload {
  path: BattleAPIDocument['path']
  data: BattleAPIDocument['data']
  origin: BattleAPIDocument['origin']
}

const BattleAPISchema = new mongoose.Schema<BattleAPIDocument>({
  origin: String,
  path: String,
  data: Object,
})

export const BattleAPI = mongoose.model<BattleAPIDocument>('BattleAPI', BattleAPISchema)
