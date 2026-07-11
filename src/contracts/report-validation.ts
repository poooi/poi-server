import { type AppRequest } from '../http/request'
import { ReportPayloadValidationError } from './report-errors'

type ReportFieldKind =
  | 'boolean'
  | 'integer'
  | 'integerArray'
  | 'json'
  | 'jsonArray'
  | 'nestedIntegerArray'
  | 'number'
  | 'numberArray'
  | 'safeInteger'
  | 'string'

export interface ReportFieldSchema {
  kind: ReportFieldKind
  required?: boolean
}

export type ReportPayloadSchema = Record<string, ReportFieldSchema>

interface ValidationIssue {
  path: string
  code: 'invalid_type' | 'out_of_range' | 'required'
  expectedType: string
  receivedType: string
  invalidValue?: boolean | number | string | null
  receivedSize?: number
}

interface ExternalValidationIssue {
  code?: string
  message?: string
  path?: PropertyKey[]
}

const getReceivedType = (value: unknown): string => {
  if (value === null) {
    return 'null'
  }
  if (Array.isArray(value)) {
    return 'array'
  }
  return typeof value
}

const toLoggedIssue = (issue: ValidationIssue, value: unknown): ValidationIssue => {
  if (typeof value === 'string') {
    return { ...issue, invalidValue: value.slice(0, 256) }
  }

  if (value == null || ['boolean', 'number'].includes(typeof value)) {
    return { ...issue, invalidValue: value as boolean | number | null }
  }
  if (Array.isArray(value)) {
    return { ...issue, receivedSize: value.length }
  }
  if (typeof value === 'object') {
    return { ...issue, receivedSize: Object.keys(value).length }
  }
  return issue
}

export const rejectReportPayload = (
  request: Pick<AppRequest, 'log' | 'path'>,
  path: string,
  expectedType: string,
  value: unknown,
): never => {
  const issue = toLoggedIssue(
    {
      path,
      code: 'invalid_type',
      expectedType,
      receivedType: getReceivedType(value),
    },
    value,
  )
  request.log.warn(
    {
      endpoint: request.path,
      event: 'report_validation_rejected',
      issues: [issue],
    },
    'Report validation rejected',
  )
  throw new ReportPayloadValidationError(`${path}: expected ${expectedType}`, true)
}

const getValueAtPath = (value: unknown, path: PropertyKey[]): unknown => {
  let current = value
  for (const segment of path) {
    if (current == null || typeof current !== 'object') {
      return undefined
    }
    current = (current as Record<PropertyKey, unknown>)[segment]
  }
  return current
}

export const logReportValidationIssues = (
  request: Pick<AppRequest, 'log' | 'path'>,
  issues: ExternalValidationIssue[],
  payload: unknown,
): void => {
  const loggedIssues = issues.slice(0, 20).map((issue) => {
    const path = issue.path || []
    const value = getValueAtPath(payload, path)
    return toLoggedIssue(
      {
        path: path.join('.'),
        code: issue.code === 'required' ? 'required' : 'invalid_type',
        expectedType: issue.message || 'valid value',
        receivedType: getReceivedType(value),
      },
      value,
    )
  })
  request.log.warn(
    {
      endpoint: request.path,
      event: 'report_validation_rejected',
      issues: loggedIssues,
    },
    'Report validation rejected',
  )
}

const invalid = (
  path: string,
  code: ValidationIssue['code'],
  expectedType: string,
  value: unknown,
): never => {
  throw toLoggedIssue(
    {
      path,
      code,
      expectedType,
      receivedType: getReceivedType(value),
    },
    value,
  )
}

const castNumber = (value: unknown, path: string): number | null => {
  if (value === null || value === '') {
    return null
  }
  if (typeof value !== 'number' && typeof value !== 'string' && typeof value !== 'boolean') {
    return invalid(path, 'invalid_type', 'finite number', value)
  }
  const number = Number(value)
  if (!Number.isFinite(number)) {
    return invalid(path, 'invalid_type', 'finite number', value)
  }
  return number
}

const castInteger = (value: unknown, path: string): number | null => {
  const number = castNumber(value, path)
  if (number == null) {
    return null
  }
  if (!Number.isInteger(number)) {
    return invalid(path, 'invalid_type', 'signed 32-bit integer', value)
  }
  if (number < -2147483648 || number > 2147483647) {
    return invalid(path, 'out_of_range', 'signed 32-bit integer', value)
  }
  return number
}

const castSafeInteger = (value: unknown, path: string): number | null => {
  const number = castNumber(value, path)
  if (number == null) {
    return null
  }
  if (!Number.isSafeInteger(number) || number < 0) {
    return invalid(path, 'out_of_range', 'non-negative safe integer', value)
  }
  return number
}

const castBoolean = (value: unknown, path: string): boolean | null => {
  if (value === null || value === '') {
    return null
  }
  if (typeof value === 'boolean') {
    return value
  }
  if (value === 0 || value === '0' || value === 'false' || value === 'no') {
    return false
  }
  if (value === 1 || value === '1' || value === 'true' || value === 'yes') {
    return true
  }
  return invalid(path, 'invalid_type', 'boolean', value)
}

const castString = (value: unknown, path: string): string | null => {
  if (value === null) {
    return null
  }
  if (typeof value === 'object' || value === undefined) {
    return invalid(path, 'invalid_type', 'string', value)
  }
  return String(value)
}

const castArray = (
  value: unknown,
  path: string,
  castElement: (value: unknown, path: string) => number | null,
): Array<number | null> | null => {
  if (value === null) {
    return null
  }
  const values = Array.isArray(value) ? value : [value]
  return values.map((item, index) => castElement(item, `${path}.${index}`))
}

const assertFiniteJson = (value: unknown, path: string): unknown => {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return invalid(path, 'invalid_type', 'finite JSON value', value)
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => assertFiniteJson(item, `${path}.${index}`))
  }
  if (value != null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, assertFiniteJson(item, `${path}.${key}`)]),
    )
  }
  return value
}

const castField = (value: unknown, path: string, kind: ReportFieldKind): unknown => {
  switch (kind) {
    case 'boolean':
      return castBoolean(value, path)
    case 'integer':
      return castInteger(value, path)
    case 'integerArray':
      return castArray(value, path, castInteger)
    case 'json':
      return assertFiniteJson(value, path)
    case 'jsonArray': {
      if (value === null) {
        return null
      }
      const values = Array.isArray(value) ? value : [value]
      return values.map((item, index) => assertFiniteJson(item, `${path}.${index}`))
    }
    case 'nestedIntegerArray': {
      if (value === null) {
        return null
      }
      const values = Array.isArray(value) ? value : [value]
      return values.map((item, index) => castArray(item, `${path}.${index}`, castInteger))
    }
    case 'number':
      return castNumber(value, path)
    case 'numberArray':
      return castArray(value, path, castNumber)
    case 'safeInteger':
      return castSafeInteger(value, path)
    case 'string':
      return castString(value, path)
  }
}

export const normalizeReportPayload = <T extends object = Record<string, unknown>>(
  payload: Record<string, unknown>,
  schema: ReportPayloadSchema,
  request: Pick<AppRequest, 'log' | 'path'>,
  pathPrefix = '',
): T => {
  const normalized: Record<string, unknown> = {}
  const issues: ValidationIssue[] = []

  for (const [fieldName, field] of Object.entries(schema)) {
    const path = pathPrefix === '' ? fieldName : `${pathPrefix}.${fieldName}`
    const hasValue = Object.prototype.hasOwnProperty.call(payload, fieldName)
    const value = payload[fieldName]
    if (!hasValue) {
      if (field.required) {
        issues.push(
          toLoggedIssue(
            {
              path,
              code: 'required',
              expectedType: field.kind,
              receivedType: 'undefined',
            },
            undefined,
          ),
        )
      } else if (field.kind.endsWith('Array')) {
        normalized[fieldName] = []
      }
      continue
    }

    try {
      normalized[fieldName] = castField(value, path, field.kind)
      if (field.required && normalized[fieldName] == null) {
        invalid(path, 'required', field.kind, value)
      }
    } catch (issue) {
      issues.push(issue as ValidationIssue)
    }
  }

  if (issues.length > 0) {
    request.log.warn(
      {
        endpoint: request.path,
        event: 'report_validation_rejected',
        issues: issues.slice(0, 20),
      },
      'Report validation rejected',
    )
    const first = issues[0]
    throw new ReportPayloadValidationError(`${first.path}: expected ${first.expectedType}`, true)
  }

  return normalized as T
}
