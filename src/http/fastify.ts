import { type FastifyReply, type FastifyRequest } from 'fastify'

import { type AppRequest } from './request'
import { type AppResult } from './result'

export const toAppRequest = (request: FastifyRequest): AppRequest => ({
  body: request.body,
  headers: request.headers,
  method: request.method,
  params: request.params as Record<string, string | undefined>,
  path: request.url.split('?')[0] || request.url,
  query: request.query as Record<string, unknown>,
  url: request.url,
})

export const sendResult = (reply: FastifyReply, result: AppResult) => {
  for (const [name, value] of Object.entries(result.headers || {})) {
    reply.header(name, value)
  }
  return reply.code(result.status).send(result.body)
}
