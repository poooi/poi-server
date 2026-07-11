import { describe, expect, test, vi } from 'vitest'

import { resolveAaciPersistence } from '../src/controllers/api/report/shared'
import { type AppRequest } from '../src/http/request'

const createRequest = (): AppRequest => ({
  body: {},
  headers: {},
  log: { warn: vi.fn() },
  method: 'POST',
  params: {},
  path: '/api/report/v2/aaci',
  query: {},
  url: '/api/report/v2/aaci',
})

describe('resolveAaciPersistence', () => {
  test('persists when poi version exceeds 7.9.1 and reporter version is at least 3.6.0', () => {
    const request = createRequest()

    expect(resolveAaciPersistence(request, '7.9.2', 'Reporter 3.6.0')).toBe(true)
  })

  test('does not persist when poi version does not exceed 7.9.1', () => {
    const request = createRequest()

    expect(resolveAaciPersistence(request, '7.9.1', 'Reporter 3.6.0')).toBe(false)
  })

  test('does not persist when origin does not start with "Reporter "', () => {
    const request = createRequest()

    expect(resolveAaciPersistence(request, '8.0.0', 'poi/10.3.99')).toBe(false)
  })

  test('does not persist when reporter version is below 3.6.0', () => {
    const request = createRequest()

    expect(resolveAaciPersistence(request, '8.0.0', 'Reporter 3.5.9')).toBe(false)
  })

  test('rejects an invalid poiVersion with a logged 400-shaped error', () => {
    const request = createRequest()

    expect(() => resolveAaciPersistence(request, 'not-semver', 'Reporter 3.6.0')).toThrow(
      'poiVersion: expected semantic version',
    )
    expect(request.log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'report_validation_rejected' }),
      'Report validation rejected',
    )
  })

  test('rejects an invalid Reporter suffix version with a logged 400-shaped error', () => {
    const request = createRequest()

    expect(() => resolveAaciPersistence(request, '8.0.0', 'Reporter not-semver')).toThrow(
      'origin: expected Reporter <semantic version>',
    )
  })
})
