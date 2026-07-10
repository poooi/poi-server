import { type RequiredItem } from './item-improvement-recipe'

export interface ItemImprovementAvailabilityKeyFields {
  day: number
  itemId: number
  observedSecondShipId: number
  recipeId: number
}

export interface ItemImprovementCostKeyFields extends ItemImprovementAvailabilityKeyFields {
  ammo: number
  bauxite: number
  buildkit: number
  certainBuildkit: number
  certainRemodelkit: number
  changeFlag: number
  fuel: number
  itemLevel: number
  remodelkit: number
  reqSlotItems: RequiredItem[]
  reqUseItems: RequiredItem[]
  stage: number
  steel: number
}

export interface ItemImprovementUpdateKeyFields extends ItemImprovementAvailabilityKeyFields {
  itemLevel: number
  upgradeToItemId: number
  upgradeToItemLevel: number
}

const serializeRequiredItems = (items: RequiredItem[]) =>
  items.length > 0 ? items.map(({ id, count }) => `${id}:${count}`).join(',') : '-'

export const createItemImprovementAvailabilityKey = (
  record: ItemImprovementAvailabilityKeyFields,
) =>
  [
    'v1',
    'availability',
    record.recipeId,
    record.itemId,
    record.day,
    record.observedSecondShipId,
  ].join('|')

export const createItemImprovementCostKey = (record: ItemImprovementCostKeyFields) =>
  [
    'v1',
    'cost',
    record.recipeId,
    record.itemId,
    record.itemLevel,
    record.stage,
    record.day,
    record.observedSecondShipId,
    record.fuel,
    record.ammo,
    record.steel,
    record.bauxite,
    record.buildkit,
    record.remodelkit,
    record.certainBuildkit,
    record.certainRemodelkit,
    serializeRequiredItems(record.reqSlotItems),
    serializeRequiredItems(record.reqUseItems),
    record.changeFlag,
  ].join('|')

export const createItemImprovementUpdateKey = (record: ItemImprovementUpdateKeyFields) =>
  [
    'v1',
    'update',
    record.recipeId,
    record.itemId,
    record.itemLevel,
    record.day,
    record.observedSecondShipId,
    record.upgradeToItemId,
    record.upgradeToItemLevel,
  ].join('|')
