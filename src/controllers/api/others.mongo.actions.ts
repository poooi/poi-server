import mongoose from 'mongoose'

const CreateShipRecord = mongoose.model('CreateShipRecord')
const CreateItemRecord = mongoose.model('CreateItemRecord')
const RemodelItemRecord = mongoose.model('RemodelItemRecord')
const DropShipRecord = mongoose.model('DropShipRecord')
const SelectRankRecord = mongoose.model('SelectRankRecord')
const PassEventRecord = mongoose.model('PassEventRecord')
const Quest = mongoose.model('Quest')
const BattleAPI = mongoose.model('BattleAPI')
const AACIRecord = mongoose.model('AACIRecord')
const NightContactRecord = mongoose.model('NightContactRecord')

export const getStatus = async () => ({
  CreateShipRecord: await CreateShipRecord.count().exec(),
  CreateItemRecord: await CreateItemRecord.count().exec(),
  RemodelItemRecord: await RemodelItemRecord.count().exec(),
  DropShipRecord: await DropShipRecord.count().exec(),
  SelectRankRecord: await SelectRankRecord.count().exec(),
  PassEventRecord: await PassEventRecord.count().exec(),
  Quest: await Quest.count().exec(),
  BattleAPI: await BattleAPI.count().exec(),
  AACIRecord: await AACIRecord.count().exec(),
  NightContactRecord: await NightContactRecord.count().exec(),
})
