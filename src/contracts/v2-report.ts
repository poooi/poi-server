import { type ReportPayloadSchema } from './report-validation'

const integer = { kind: 'integer' } as const
const requiredInteger = { kind: 'integer', required: true } as const
const integerArray = { kind: 'integerArray' } as const
const nestedIntegerArray = { kind: 'nestedIntegerArray' } as const
const boolean = { kind: 'boolean' } as const
const string = { kind: 'string' } as const
const requiredString = { kind: 'string', required: true } as const
const json = { kind: 'json' } as const
const jsonArray = { kind: 'jsonArray' } as const

export const createShipReportSchema: ReportPayloadSchema = {
  items: integerArray,
  kdockId: integer,
  secretary: integer,
  shipId: integer,
  highspeed: integer,
  teitokuLv: integer,
  largeFlag: boolean,
  origin: string,
}

export const createItemReportSchema: ReportPayloadSchema = {
  items: integerArray,
  secretary: integer,
  itemId: integer,
  teitokuLv: integer,
  successful: boolean,
  origin: string,
}

export const remodelItemReportSchema: ReportPayloadSchema = {
  successful: boolean,
  itemId: integer,
  itemLevel: integer,
  flagshipId: integer,
  flagshipLevel: integer,
  flagshipCond: integer,
  consortId: integer,
  consortLevel: integer,
  consortCond: integer,
  teitokuLv: integer,
  certain: boolean,
}

export const dropShipReportSchema: ReportPayloadSchema = {
  shipId: integer,
  itemId: integer,
  mapId: integer,
  quest: string,
  cellId: integer,
  enemy: string,
  rank: string,
  isBoss: boolean,
  teitokuLv: integer,
  mapLv: integer,
  enemyShips1: integerArray,
  enemyShips2: integerArray,
  enemyFormation: integer,
  baseExp: integer,
  teitokuId: string,
  ownedShipSnapshot: json,
  origin: string,
}

export const selectRankReportSchema: ReportPayloadSchema = {
  teitokuId: requiredString,
  teitokuLv: integer,
  mapareaId: requiredInteger,
  rank: integer,
  origin: string,
}

export const passEventReportSchema: ReportPayloadSchema = {
  teitokuId: string,
  teitokuLv: integer,
  mapId: integer,
  mapLv: integer,
  rewards: jsonArray,
  origin: string,
}

export const battleApiReportSchema: ReportPayloadSchema = {
  origin: string,
  path: string,
  data: json,
}

export const nightContactReportSchema: ReportPayloadSchema = {
  fleetType: integer,
  shipId: integer,
  shipLv: integer,
  itemId: integer,
  itemLv: integer,
  contact: boolean,
}

export const aaciReportSchema: ReportPayloadSchema = {
  poiVersion: requiredString,
  available: integerArray,
  triggered: integer,
  items: integerArray,
  improvement: integerArray,
  rawLuck: integer,
  rawTaiku: integer,
  lv: integer,
  hpPercent: { kind: 'number' },
  pos: integer,
  origin: string,
}

export const recipeReportSchema: ReportPayloadSchema = {
  recipeId: requiredInteger,
  itemId: requiredInteger,
  stage: requiredInteger,
  day: requiredInteger,
  secretary: requiredInteger,
  fuel: integer,
  ammo: integer,
  steel: integer,
  bauxite: integer,
  reqItemId: integer,
  reqItemCount: integer,
  buildkit: integer,
  remodelkit: integer,
  certainBuildkit: integer,
  certainRemodelkit: integer,
  upgradeToItemId: integer,
  upgradeToItemLevel: integer,
  key: string,
  origin: string,
}

export const nightBattleCiReportSchema: ReportPayloadSchema = {
  shipId: integer,
  CI: string,
  type: string,
  lv: integer,
  rawLuck: integer,
  pos: integer,
  status: string,
  items: integerArray,
  improvement: integerArray,
  searchLight: boolean,
  flare: integer,
  defenseId: integer,
  defenseTypeId: integer,
  ciType: integer,
  display: integerArray,
  hitType: integerArray,
  damage: { kind: 'numberArray' },
  damageTotal: { kind: 'number' },
  time: { kind: 'safeInteger' },
  origin: string,
}

export const shipStatReportSchema: ReportPayloadSchema = {
  id: requiredInteger,
  lv: requiredInteger,
  los: requiredInteger,
  los_max: requiredInteger,
  asw: requiredInteger,
  asw_max: requiredInteger,
  evasion: requiredInteger,
  evasion_max: requiredInteger,
}

export const enemyInfoReportSchema: ReportPayloadSchema = {
  ships1: { ...integerArray, required: true },
  levels1: { ...integerArray, required: true },
  hp1: { ...integerArray, required: true },
  stats1: { ...nestedIntegerArray, required: true },
  equips1: { ...nestedIntegerArray, required: true },
  ships2: { ...integerArray, required: true },
  levels2: { ...integerArray, required: true },
  hp2: { ...integerArray, required: true },
  stats2: { ...nestedIntegerArray, required: true },
  equips2: { ...nestedIntegerArray, required: true },
  planes: requiredInteger,
  bombersMin: integer,
  bombersMax: integer,
}
