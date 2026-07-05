import { type AppRequest } from './request'
import { type AppResult } from './result'

export const cloudflareCacheHeaders = {
  'Cache-Control': 'public, max-age=60',
  'Cloudflare-CDN-Cache-Control':
    'public, max-age=600, stale-while-revalidate=60, stale-if-error=300',
}

export const withCloudflareCache = (request: AppRequest, result: AppResult): AppResult => {
  if (request.method !== 'GET' || result.status !== 200) {
    return result
  }

  return {
    ...result,
    headers: {
      ...result.headers,
      ...cloudflareCacheHeaders,
    },
  }
}
