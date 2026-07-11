import df from '@sindresorhus/df'
import childProcess from 'child_process'
import { makeBadge } from 'badge-maker'
import path from 'path'

import { config } from '../../config'
import { type DatabaseStatus, legacyMongoEpoch } from '../../contracts/database'
import { ok, type AppResult } from '../../http/result'
import {
  AACIRecord,
  BattleAPI,
  CreateItemRecord,
  CreateShipRecord,
  DropShipRecord,
  EnemyInfo,
  ItemImprovementRecipeAvailabilityFact,
  ItemImprovementRecipeCostFact,
  ItemImprovementRecipeUpdateFact,
  NightBattleCI,
  NightContactRecord,
  PassEventRecord,
  Quest,
  QuestReward,
  RecipeRecord,
  RemodelItemRecord,
  SelectRankRecord,
  ShipStat,
} from '../../models'

export const getStatus = async (): Promise<AppResult> => {
  const dsk = await df()
  const [
    createShipObservations,
    createItemObservations,
    remodelItemObservations,
    dropShipObservations,
    passEventObservations,
    battleApiObservations,
    nightContactObservations,
    aaciObservations,
    nightBattleCiObservations,
    selectRankStates,
    recipeAggregates,
    shipStatAggregates,
    enemyInfoAggregates,
    questDefinitions,
    questRewardDefinitions,
    itemImprovementAvailabilityFacts,
    itemImprovementCostFacts,
    itemImprovementUpdateFacts,
  ] = await Promise.all([
    CreateShipRecord.estimatedDocumentCount().exec(),
    CreateItemRecord.estimatedDocumentCount().exec(),
    RemodelItemRecord.estimatedDocumentCount().exec(),
    DropShipRecord.estimatedDocumentCount().exec(),
    PassEventRecord.estimatedDocumentCount().exec(),
    BattleAPI.estimatedDocumentCount().exec(),
    NightContactRecord.estimatedDocumentCount().exec(),
    AACIRecord.estimatedDocumentCount().exec(),
    NightBattleCI.estimatedDocumentCount().exec(),
    SelectRankRecord.estimatedDocumentCount().exec(),
    RecipeRecord.estimatedDocumentCount().exec(),
    ShipStat.estimatedDocumentCount().exec(),
    EnemyInfo.estimatedDocumentCount().exec(),
    Quest.estimatedDocumentCount().exec(),
    QuestReward.estimatedDocumentCount().exec(),
    ItemImprovementRecipeAvailabilityFact.estimatedDocumentCount().exec(),
    ItemImprovementRecipeCostFact.estimatedDocumentCount().exec(),
    ItemImprovementRecipeUpdateFact.estimatedDocumentCount().exec(),
  ])
  const database: DatabaseStatus = {
    backend: 'mongodb',
    status: 'up',
    epoch: legacyMongoEpoch,
    estimatedCounts: {
      createShipObservations,
      createItemObservations,
      remodelItemObservations,
      dropShipObservations,
      passEventObservations,
      battleApiObservations,
      nightContactObservations,
      aaciObservations,
      nightBattleCiObservations,
      selectRankStates,
      recipeAggregates,
      shipStatAggregates,
      enemyInfoAggregates,
      questDefinitions,
      questRewardDefinitions,
      itemImprovementAvailabilityFacts,
      itemImprovementCostFacts,
      itemImprovementUpdateFacts,
    },
  }
  return ok({
    env: process.env.NODE_ENV,
    disk: dsk.filter((e) => e.mountpoint == '/'),
    database,
  })
}

export const runGithubMasterHook = async (): Promise<AppResult> => {
  const update = childProcess.spawn(path.resolve(config.root, '../github-master-hook'), [])
  update.stdout.on('data', (data) => console.log('GitHub hook out: ' + data))
  update.stderr.on('data', (data) => console.log('GitHub hook err: ' + data))
  update.on('close', (code) => console.log('GitHub hook exit: ' + code))
  return ok({ code: 0 })
}

export const getLatestCommit = async (): Promise<AppResult> => ok(global.latestCommit)

let serviceUpBadge: string

export const getServiceStatusBadge = async (): Promise<AppResult> => {
  if (!serviceUpBadge) {
    serviceUpBadge = makeBadge({
      label: 'service',
      message: 'up',
      color: 'success',
      style: 'flat-square',
    })
  }

  return ok(serviceUpBadge)
}

let serviceVersionBadge: string

export const getServiceVersionBadge = async (): Promise<AppResult> => {
  if (!serviceVersionBadge) {
    serviceVersionBadge = makeBadge({
      label: 'version',
      message: global.latestCommit?.slice(0, 8) || '',
      color: 'informational',
      style: 'flat-square',
    })
  }

  return ok(serviceVersionBadge)
}

export const svgHeaders = {
  'Content-Type': 'image/svg+xml',
}
