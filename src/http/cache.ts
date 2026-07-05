import Cache from 'node-cache'

import { type AppRequest } from './request'
import { type AppResult } from './result'

interface CacheEntry {
  body: unknown
  headers?: Record<string, string>
  status: number
}

const responseCache = new Cache({
  checkperiod: 0,
  stdTTL: 10 * 60,
})

export const createCacheKey = (request: AppRequest) => `${request.method} ${request.url}`

export const getCachedResult = (request: AppRequest): AppResult | undefined => {
  const entry = responseCache.get<CacheEntry>(createCacheKey(request))
  return entry == null ? undefined : { ...entry }
}

export const setCachedResult = (request: AppRequest, result: AppResult): AppResult => {
  if (request.method === 'GET' && result.status === 200) {
    responseCache.set(createCacheKey(request), {
      body: result.body,
      headers: result.headers,
      status: result.status,
    })
  }
  return result
}

export const cached = async (
  request: AppRequest,
  resolve: () => Promise<AppResult>,
): Promise<AppResult> => {
  const hit = getCachedResult(request)
  if (hit != null) {
    return hit
  }
  return setCachedResult(request, await resolve())
}

export const clearResponseCacheForTests = () => {
  responseCache.flushAll()
}
