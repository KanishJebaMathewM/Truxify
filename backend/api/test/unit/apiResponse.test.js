import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { errorResponse } from '../../src/utils/apiResponse.js'

describe('errorResponse', () => {
  const originalEnv = process.env.NODE_ENV

  beforeEach(() => {
    process.env.NODE_ENV = 'development'
  })

  afterEach(() => {
    process.env.NODE_ENV = originalEnv
  })

  it('returns a non-success response with code and message', () => {
    const res = errorResponse(400, 'Bad Request')
    expect(res.success).toBe(false)
    expect(res.error.code).toBe(400)
    expect(res.error.message).toBe('Bad Request')
  })

  it('includes details when not in production', () => {
    const res = errorResponse(400, 'Bad Request', { field: 'name' })
    expect(res.error.details).toEqual({ field: 'name' })
  })

  it('omits details in production', () => {
    process.env.NODE_ENV = 'production'
    const res = errorResponse(500, 'Server Error', { field: 'x' })
    expect(res.error.details).toBeUndefined()
  })

  it('does not add a details key when details is undefined', () => {
    const res = errorResponse(404, 'Not Found')
    expect('details' in res.error).toBe(false)
  })
})
