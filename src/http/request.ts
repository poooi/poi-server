import { type IncomingHttpHeaders } from 'http'

export interface AppRequest {
  body: unknown
  headers: IncomingHttpHeaders
  method: string
  params: Record<string, string | undefined>
  path: string
  query: Record<string, unknown>
  url: string
}

export const getHeader = (request: Pick<AppRequest, 'headers'>, name: string): string => {
  const value = request.headers[name.toLowerCase()]
  return Array.isArray(value) ? value.join(',') : value || ''
}
