import { type FastifyReply, type FastifyRequest } from 'fastify'

import { type AppRequest } from './request'
import { type AppResult } from './result'

const normalizeQueryValue = (value: unknown): string | undefined => {
  if (Array.isArray(value)) {
    const lastValue = value[value.length - 1]
    return lastValue == null ? undefined : String(lastValue)
  }
  return value == null ? undefined : String(value)
}

const normalizeQuery = (query: unknown): Record<string, string | undefined> => {
  if (query == null || typeof query !== 'object') {
    return {}
  }
  return Object.fromEntries(
    Object.entries(query).map(([key, value]) => [key, normalizeQueryValue(value)]),
  )
}

export const toAppRequest = (request: FastifyRequest): AppRequest => ({
  body: request.body,
  headers: request.headers,
  method: request.method,
  params: request.params as Record<string, string | undefined>,
  path: request.url.split('?')[0] || request.url,
  query: normalizeQuery(request.query),
  url: request.url,
})

export const sendResult = (reply: FastifyReply, result: AppResult) => {
  for (const [name, value] of Object.entries(result.headers || {})) {
    reply.header(name, value)
  }
  return reply.code(result.status).send(result.body)
}
