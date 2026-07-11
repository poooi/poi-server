import { type AppRequest } from '../http/request'
import { type QuestPayload, type QuestRewardPayload } from '../models'
import {
  normalizeReportPayload,
  rejectReportPayload,
  type ReportPayloadSchema,
} from './report-validation'

const requiredInteger = { kind: 'integer', required: true } as const
const integer = { kind: 'integer' } as const
const requiredString = { kind: 'string', required: true } as const
const string = { kind: 'string' } as const
const integerArray = { kind: 'integerArray' } as const
const requiredIntegerArray = { kind: 'integerArray', required: true } as const
const jsonArray = { kind: 'jsonArray' } as const

const questSchema: ReportPayloadSchema = {
  questId: requiredInteger,
  title: requiredString,
  detail: requiredString,
  category: requiredInteger,
  type: integer,
}

const questRewardSchema: ReportPayloadSchema = {
  questId: requiredInteger,
  title: requiredString,
  detail: requiredString,
  category: integer,
  type: integer,
  origin: string,
  selections: requiredIntegerArray,
  material: integerArray,
  bonus: jsonArray,
  bounsCount: requiredInteger,
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value)

export const normalizeQuestReport = (
  info: Record<string, unknown>,
  request: AppRequest,
): { quests: Array<Omit<QuestPayload, 'origin'>>; origin: string } => {
  const questValues: unknown[] = Array.isArray(info.quests)
    ? info.quests
    : rejectReportPayload(request, 'quests', 'array', info.quests)
  const origin = String(info.origin || '')
  const quests = questValues.map((item: unknown, index: number) => {
    if (isRecord(item)) {
      return normalizeReportPayload<Omit<QuestPayload, 'origin'>>(
        item,
        questSchema,
        request,
        `quests.${index}`,
      )
    }
    return rejectReportPayload(request, `quests.${index}`, 'object', item)
  })
  return { quests, origin }
}

export const normalizeQuestRewardReport = (info: Record<string, unknown>, request: AppRequest) =>
  normalizeReportPayload<QuestRewardPayload>(info, questRewardSchema, request)
