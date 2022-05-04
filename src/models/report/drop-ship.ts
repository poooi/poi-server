import mongoose, { Document } from 'mongoose'

export interface DropShipRecordPayload {
  shipId: number
  itemId: number
  mapId: number
  quest: string
  cellId: number
  enemy: string
  rank: string
  isBoss: boolean
  teitokuLv: number
  mapLv: number
  enemyShips1: number[]
  enemyShips2: number[]
  enemyFormation: number
  baseExp: number
  teitokuId: string
  shipCounts: number[]
  ownedShipSnapshot: Record<number, number[]>
  origin: string
}

interface DropShipRecordDocument extends Document, DropShipRecordPayload {}

const DropShipRecordSchema = new mongoose.Schema<DropShipRecordDocument>({
  shipId: Number,
  itemId: Number,
  mapId: Number,
  quest: String,
  cellId: Number,
  enemy: String,
  rank: String,
  isBoss: Boolean,
  teitokuLv: Number,
  mapLv: Number,
  enemyShips1: [Number],
  enemyShips2: [Number],
  enemyFormation: Number,
  baseExp: Number,
  teitokuId: String,
  ownedShipSnapshot: mongoose.SchemaTypes.Mixed,
  origin: String,
})

export const DropShipRecord = mongoose.model<DropShipRecordDocument>(
  'DropShipRecord',
  DropShipRecordSchema,
)
