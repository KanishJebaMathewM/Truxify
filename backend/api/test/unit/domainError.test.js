import { describe, it, expect } from 'vitest'
import { DomainError } from '../../src/services/order/domainError.js'

describe('DomainError', () => {
  it('carries status and payload', () => {
    const err = new DomainError(400, { error: 'invalid order' })
    expect(err.status).toBe(400)
    expect(err.payload).toEqual({ error: 'invalid order' })
    expect(err.name).toBe('DomainError')
    expect(err.message).toBe('invalid order')
  })

  it('derives the message from payload.message when error is absent', () => {
    const err = new DomainError(403, { message: 'forbidden' })
    expect(err.message).toBe('forbidden')
  })

  it('falls back to a default message', () => {
    const err = new DomainError(500, {})
    expect(err.message).toBe('Domain Error')
  })
})
