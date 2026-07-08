import crypto from 'crypto'

import { asc } from 'drizzle-orm'

import { config } from '../../../config'
import { getPostgresDb } from '../../../db/postgres'
import { questRewards, quests } from '../../../db/schema/postgres'
import { type QuestPayload, type QuestRewardPayload } from '../../../models'
export {
  ItemImprovementRecipeValidationError,
  getItemImprovementRecipeValidationErrorMessage,
  isItemImprovementValidationError,
} from './v3.mongo.actions'

const getDb = () => getPostgresDb(config.db)

const createQuestHash = ({ title, detail }: QuestPayload | QuestRewardPayload) =>
  crypto.createHash('md5').update(`${title}${detail}`).digest('hex')

const notYetImplemented = () => {
  throw new Error('PostgreSQL item-improvement actions are not yet implemented')
}

export const itemImprovementRecipe = async (): Promise<number> => notYetImplemented()

export const itemImprovementRecipeAvailability = async (): Promise<never> => notYetImplemented()

export const itemImprovementRecipeCosts = async (): Promise<never> => notYetImplemented()

export const itemImprovementRecipeUpdates = async (): Promise<never> => notYetImplemented()

export const knownQuests = async (): Promise<string[]> => {
  const records = await getDb()
    .selectDistinct({ key: quests.key })
    .from(quests)
    .orderBy(asc(quests.key))
  return records.map((record) => record.key.slice(0, 8))
}

export const quest = async (info: Record<string, any>): Promise<void> => {
  const records = info.quests.map((questItem: QuestPayload) => ({
    questId: questItem.questId,
    title: questItem.title,
    detail: questItem.detail,
    category: questItem.category,
    type: questItem.type,
    origin: info.origin,
    key: createQuestHash(questItem),
    rawPayload: {
      ...questItem,
      origin: info.origin,
      key: createQuestHash(questItem),
    },
  }))

  if (records.length === 0) {
    return
  }

  await getDb().insert(quests).values(records).onConflictDoNothing()
}

export const questReward = async (info: QuestRewardPayload): Promise<void> => {
  const key = createQuestHash(info)
  const bonusCount = info.bounsCount

  await getDb()
    .insert(questRewards)
    .values({
      key,
      questId: info.questId,
      title: info.title,
      detail: info.detail,
      category: info.category,
      type: info.type,
      origin: info.origin,
      selections: info.selections,
      material: info.material,
      bonus: info.bonus,
      bonusCount,
      rawPayload: { ...info },
    })
    .onConflictDoNothing()
}
