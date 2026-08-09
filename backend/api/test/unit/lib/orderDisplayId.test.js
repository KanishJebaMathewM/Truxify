/**
 * Unit tests for backend/api/src/lib/orderDisplayId.js
 *
 * Coverage:
 *   - format: `#FF<YYYYMMDD><12-char alphanumeric>`
 *   - character set: only A-Z and 0-9 in the random suffix
 *   - uniqueness across a large batch (no collisions)
 *   - ORDER_DISPLAY_ID_MAX_RETRIES is a positive bounded retry cap
 *
 * Run with:  npm test -- test/unit/lib/orderDisplayId.test.js
 */
import { describe, it, expect } from 'vitest'
import { generateOrderDisplayId, ORDER_DISPLAY_ID_MAX_RETRIES } from '../../../src/lib/orderDisplayId.js'

const ID_RE = /^#FF\d{8}[A-Z0-9]{12}$/

describe('orderDisplayId — generateOrderDisplayId', () => {
  it('returns ids matching `#FF<YYYYMMDD><12-char alphanumeric>`', () => {
    for (let i = 0; i < 100; i++) {
      expect(generateOrderDisplayId()).toMatch(ID_RE)
    }
  })

  it('produces a random suffix drawn only from A-Z and 0-9', () => {
    const suffix = generateOrderDisplayId().slice(11)
    expect(suffix).toMatch(/^[A-Z0-9]{12}$/)
    expect(suffix).not.toMatch(/[a-z]/)
    expect(suffix).not.toMatch(/[^A-Z0-9]/)
  })

  it('does not reuse a previous 6-digit numeric suffix', () => {
    // The issue (#5740) is that the old `#FF<date><6 digits>` format only had
    // ~900k values/day. Assert the suffix is at least 10 chars of A-Z0-9.
    const suffix = generateOrderDisplayId().slice(11)
    expect(suffix.length).toBeGreaterThanOrEqual(10)
  })

  it('produces unique ids across a large batch', () => {
    const ids = new Set()
    for (let i = 0; i < 10000; i++) {
      ids.add(generateOrderDisplayId())
    }
    expect(ids.size).toBe(10000)
  })

  it('uses a bounded retry cap for callers', () => {
    expect(ORDER_DISPLAY_ID_MAX_RETRIES).toBeGreaterThanOrEqual(1)
    expect(Number.isInteger(ORDER_DISPLAY_ID_MAX_RETRIES)).toBe(true)
  })
})
