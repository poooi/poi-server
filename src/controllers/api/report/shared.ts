import { isString } from 'lodash'
import semver from 'semver'

import {
  logReportValidationIssues,
  normalizeReportPayload,
  rejectReportPayload,
  type ReportPayloadSchema,
} from '../../../contracts/report-validation'
import { ReportPayloadValidationError } from '../../../contracts/report-errors'
import { getHeader, type AppRequest } from '../../../http/request'
import { badRequest, internalServerError, type AppResult } from '../../../http/result'
import { captureException } from '../../../sentry'

export { ReportPayloadValidationError } from '../../../contracts/report-errors'

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

export const parseReportInfo = (
  request: AppRequest,
  schema?: ReportPayloadSchema,
): Record<string, any> => {
  const data = parseJsonData(getRequestData(request.body))
  if (data == null || typeof data !== 'object' || Array.isArray(data)) {
    throw new ReportPayloadValidationError('data must be a JSON object')
  }

  const info = data as Record<string, any>
  if (info.origin == null) {
    info.origin = getHeader(request, 'x-reporter') || getHeader(request, 'user-agent')
  }
  return schema == null ? info : normalizeReportPayload(info, schema, request)
}

// Shared AACI persistence gate: identical semver/version checks on both backends. Values must
// already be normalized through `aaciReportSchema`.
export const resolveAaciPersistence = (
  request: AppRequest,
  poiVersionText: string,
  origin: string,
): boolean => {
  const poiVersion =
    semver.valid(poiVersionText) ||
    rejectReportPayload(request, 'poiVersion', 'semantic version', poiVersionText)
  const reporterVersion = origin.startsWith('Reporter ')
    ? semver.valid(origin.slice('Reporter '.length)) ||
      rejectReportPayload(request, 'origin', 'Reporter <semantic version>', origin)
    : null

  return (
    semver.gt(poiVersion, '7.9.1') &&
    origin.startsWith('Reporter ') &&
    reporterVersion != null &&
    semver.gte(reporterVersion, '3.6.0')
  )
}

export const handleReportError = (err: Error, request: AppRequest): AppResult => {
  if (err instanceof ReportPayloadValidationError) {
    if (!err.logged) {
      logReportValidationIssues(
        request,
        [{ code: 'invalid_payload', message: err.message, path: ['data'] }],
        { data: getRequestData(request.body) },
      )
    }
    return badRequest(err.message)
  }

  captureException(err, request)
  return internalServerError()
}
