import mongoose, { Document } from 'mongoose'

export interface EnemyInfoPayload {
  ships1: number[]
  levels1: number[]
  hp1: number[]
  stats1: number[][]
  equips1: number[][]
  ships2: number[]
  levels2: number[]
  hp2: number[]
  stats2: number[][]
  equips2: number[][]
  planes: number
  bombersMin: number
  bombersMax: number
  count: number
}

interface EnemyInfoDocument extends EnemyInfoPayload, Document {}

const EnemyInfoSchema = new mongoose.Schema<EnemyInfoDocument>({
  ships1: [Number],
  levels1: [Number],
  hp1: [Number],
  stats1: [[Number]],
  equips1: [[Number]],
  ships2: [Number],
  levels2: [Number],
  hp2: [Number],
  stats2: [[Number]],
  equips2: [[Number]],
  planes: Number,
  bombersMin: Number,
  bombersMax: Number,
  count: Number,
})

export const EnemyInfo = mongoose.model<EnemyInfoDocument>('EnemyInfo', EnemyInfoSchema)
