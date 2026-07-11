import { describe, expect, test } from 'vitest'

import { canonicalizeObjectIdCursor } from '../src/contracts/item-improvement'

describe('item-improvement export cursor contract', () => {
  test('canonicalizes 24-character hexadecimal cursors to lowercase', () => {
    expect(canonicalizeObjectIdCursor('ABCDEF0123456789ABCDEF01')).toBe('abcdef0123456789abcdef01')
  })

  test('canonicalizes Mongoose-compatible 12-byte string cursors', () => {
    expect(canonicalizeObjectIdCursor('abcdefghijkl')).toBe('6162636465666768696a6b6c')
    expect(canonicalizeObjectIdCursor('éabcdefghijk')).toBe('e96162636465666768696a6b')
  })

  test.each(['short', 'abcdefghijkl\u0100', 'zzzzzzzzzzzzzzzzzzzzzzzz'])(
    'rejects incompatible cursor %s',
    (cursor) => {
      expect(() => canonicalizeObjectIdCursor(cursor)).toThrow('afterId: must be a valid ObjectId')
    },
  )
})
