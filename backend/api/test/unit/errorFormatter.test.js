import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { formatError } from '../../src/utils/errorFormatter.js'

describe('formatError', () => {
  const originalEnv = process.env.NODE_ENV

  beforeEach(() => {
    process.env.NODE_ENV = 'development'
  })

  afterEach(() => {
    process.env.NODE_ENV = originalEnv
  })

  it('returns a formatted error with code and message', () => {
    const err = formatError(401, 'Unauthorized')
    expect(err.success).toBe(false)
    expect(err.error.code).toBe(401)
    expect(err.error.message).toBe('Unauthorized')
  })

  it('includes details in non-production when provided', () => {
    const err = formatError(400, 'Invalid', { field: 'email' })
    expect(err.error.details).toEqual({ field: 'email' })
  })

  it('omits details in production', () => {
    process.env.NODE_ENV = 'production'
    const err = formatError(400, 'Invalid', { field: 'email' })
    expect(err.error.details).toBeUndefined()
  })

  it('omits falsy details even outside production', () => {
    const err = formatError(400, 'Invalid', null)
    expect(err.error.details).toBeUndefined()
  })
})
