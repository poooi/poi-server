import { z } from 'zod'

const objectIdHexPattern = /^[0-9a-fA-F]{24}$/

export const canonicalizeObjectIdCursor = (cursor: string): string => {
  if (objectIdHexPattern.test(cursor)) {
    return cursor.toLowerCase()
  }
  if (cursor.length === 12 && Array.from(cursor).every((value) => value.charCodeAt(0) <= 0xff)) {
    return Array.from(cursor, (value) => value.charCodeAt(0).toString(16).padStart(2, '0')).join('')
  }
  throw new Error('afterId: must be a valid ObjectId')
}

export const itemImprovementExportResponseSchema = z.object({
  records: z.array(z.record(z.string(), z.unknown())),
  next: z
    .object({
      updatedAfter: z.number(),
      afterId: z.string().regex(/^[0-9a-f]{24}$/),
    })
    .nullable(),
})
