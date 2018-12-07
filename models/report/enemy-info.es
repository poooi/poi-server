import mongoose from 'mongoose'

const EnemyInfo = new mongoose.Schema({
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

mongoose.model('EnemyInfo', EnemyInfo)
