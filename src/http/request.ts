import { type IncomingHttpHeaders } from 'http'

export interface AppRequest {
  body: unknown
  headers: IncomingHttpHeaders
  log: {
    warn: (data: Record<string, unknown>, message: string) => void
  }
  method: string
  params: Record<string, string | undefined>
  path: string
  query: Record<string, string | undefined>
  url: string
}

export const getHeader = (request: Pick<AppRequest, 'headers'>, name: string): string => {
  const value = request.headers[name.toLowerCase()]
  return Array.isArray(value) ? value.join(',') : value || ''
}

export const getClientIp = (request: Pick<AppRequest, 'headers'>): string =>
  getHeader(request, 'cf-connecting-ipv6') ||
  getHeader(request, 'cf-connecting-ip') ||
  getHeader(request, 'true-client-ip') ||
  getHeader(request, 'x-real-ip') ||
  getHeader(request, 'x-forwarded-for')
