import { count } from 'drizzle-orm'
import { type AnyPgTable } from 'drizzle-orm/pg-core'

import { config } from '../../config'
import { getPostgresDb } from '../../db/postgres'
import {
  aaciRecords,
  battleApis,
  createItemRecords,
  createShipRecords,
  dropShipRecords,
  nightContacts,
  passEventRecords,
  quests,
  remodelItemRecords,
  selectRankRecords,
} from '../../db/schema/postgres'

const getDb = () => getPostgresDb(config.db)

const getTableCount = async (table: AnyPgTable) => {
  const [{ value }] = await getDb().select({ value: count() }).from(table)
  return value
}

export const getStatus = async () => ({
  CreateShipRecord: await getTableCount(createShipRecords),
  CreateItemRecord: await getTableCount(createItemRecords),
  RemodelItemRecord: await getTableCount(remodelItemRecords),
  DropShipRecord: await getTableCount(dropShipRecords),
  SelectRankRecord: await getTableCount(selectRankRecords),
  PassEventRecord: await getTableCount(passEventRecords),
  Quest: await getTableCount(quests),
  BattleAPI: await getTableCount(battleApis),
  AACIRecord: await getTableCount(aaciRecords),
  NightContactRecord: await getTableCount(nightContacts),
})
