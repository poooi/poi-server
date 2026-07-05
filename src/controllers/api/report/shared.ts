import { isString } from 'lodash'

import { getHeader, type AppRequest } from '../../../http/request'
import { badRequest, internalServerError, type AppResult } from '../../../http/result'
import { captureException } from '../../../sentry'

export class ReportPayloadValidationError extends Error {}

export const getRequestData = (body: unknown) =>
  body != null && typeof body === 'object' && !Array.isArray(body) && 'data' in body
    ? (body as { data?: unknown }).data
    : undefined

export const parseJsonData = (data: unknown) => {
  if (!isString(data)) {
    return data
  }

  try {
    return JSON.parse(data)
  } catch {
    throw new ReportPayloadValidationError('data must be valid JSON')
  }
}

export const parseReportInfo = (request: AppRequest): Record<string, any> => {
  const data = parseJsonData(getRequestData(request.body))
  if (data == null || typeof data !== 'object' || Array.isArray(data)) {
    throw new ReportPayloadValidationError('data must be a JSON object')
  }

  const info = data as Record<string, any>
  if (info.origin == null) {
    info.origin = getHeader(request, 'x-reporter') || getHeader(request, 'user-agent')
  }
  return info
}

export const handleReportError = (err: Error, request: AppRequest): AppResult => {
  if (err instanceof ReportPayloadValidationError) {
    return badRequest(err.message)
  }

  captureException(err, request)
  return internalServerError()
}
