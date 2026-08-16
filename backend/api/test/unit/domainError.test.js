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

  it('prefers error over message when both are present', () => {
    const err = new DomainError(400, { error: 'error field', message: 'message field' })
    expect(err.message).toBe('error field')
  })

  it('uses default message when payload is null', () => {
    const err = new DomainError(500, null)
    expect(err.message).toBe('Domain Error')
    expect(err.status).toBe(500)
    expect(err.payload).toBe(null)
  })

  it('uses default message when payload is undefined', () => {
    const err = new DomainError(503, undefined)
    expect(err.message).toBe('Domain Error')
  })

  it('is an instance of Error', () => {
    const err = new DomainError(400, { error: 'test' })
    expect(err instanceof Error).toBe(true)
    expect(err instanceof DomainError).toBe(true)
  })

  it('can be caught as a regular Error', () => {
    const err = new DomainError(404, { error: 'not found' })
    let caught
    try {
      throw err
    } catch (e) {
      caught = true
      expect(e.message).toBe('not found')
    }
    expect(caught).toBe(true)
  })
})
