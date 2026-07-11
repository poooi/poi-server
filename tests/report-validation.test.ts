import { describe, expect, test, vi } from 'vitest'

import {
  normalizeReportPayload,
  type ReportPayloadSchema,
} from '../src/contracts/report-validation'
import { type AppRequest } from '../src/http/request'

const schema: ReportPayloadSchema = {
  count: { kind: 'integer', required: true },
  enabled: { kind: 'boolean' },
  ids: { kind: 'integerArray' },
  label: { kind: 'string' },
  timestamp: { kind: 'safeInteger', required: true },
}

const createRequest = (): AppRequest => ({
  body: {},
  headers: {},
  log: { warn: vi.fn() },
  method: 'POST',
  params: {},
  path: '/api/report/test',
  query: {},
  url: '/api/report/test',
})

describe('shared report payload validation', () => {
  test('preserves supported Mongoose casting and discards undeclared fields', () => {
    const request = createRequest()

    expect(
      normalizeReportPayload(
        {
          count: '42',
          enabled: 'yes',
          ids: '7',
          label: true,
          timestamp: '1700000000000',
          unknown: 'discard me',
        },
        schema,
        request,
      ),
    ).toEqual({
      count: 42,
      enabled: true,
      ids: [7],
      label: 'true',
      timestamp: 1700000000000,
    })
  })

  test('defaults omitted arrays, preserves explicit null, and normalizes empty strings', () => {
    const request = createRequest()

    expect(
      normalizeReportPayload(
        { count: true, enabled: '', ids: null, label: '', timestamp: 0 },
        schema,
        request,
      ),
    ).toEqual({
      count: 1,
      enabled: null,
      ids: null,
      label: '',
      timestamp: 0,
    })
    expect(normalizeReportPayload({ count: 1, timestamp: 1 }, schema, request)).toMatchObject({
      ids: [],
    })
  })

  test.each([
    [{ count: 1.5, timestamp: 1 }, 'count'],
    [{ count: 2147483648, timestamp: 1 }, 'count'],
    [{ count: 1, timestamp: Number.MAX_SAFE_INTEGER + 1 }, 'timestamp'],
    [{ count: 1, timestamp: -1 }, 'timestamp'],
    [{ timestamp: 1 }, 'count'],
  ])('rejects invalid numeric domains and missing identity', (payload, field) => {
    const request = createRequest()

    expect(() => normalizeReportPayload(payload, schema, request)).toThrow(`${field}:`)
    expect(request.log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: '/api/report/test',
        event: 'report_validation_rejected',
        issues: expect.arrayContaining([expect.objectContaining({ path: field })]),
      }),
      'Report validation rejected',
    )
  })

  test('bounds structured logs without including rejected objects or long strings', () => {
    const request = createRequest()
    const manyFields = Object.fromEntries(
      Array.from({ length: 25 }, (_, index) => [`field${index}`, { kind: 'integer' as const }]),
    )
    const payload = Object.fromEntries(
      Array.from({ length: 25 }, (_, index) => [
        `field${index}`,
        index === 0 ? 'x'.repeat(300) : { secret: 'never log me' },
      ]),
    )

    expect(() => normalizeReportPayload(payload, manyFields, request)).toThrow()

    const logged = vi.mocked(request.log.warn).mock.calls[0][0] as {
      issues: Array<Record<string, unknown>>
    }
    expect(logged.issues).toHaveLength(20)
    expect(logged.issues[0].invalidValue).toBe('x'.repeat(256))
    expect(logged.issues[1]).toMatchObject({ receivedType: 'object', receivedSize: 1 })
    expect(logged.issues[1]).not.toHaveProperty('invalidValue')
  })
})
