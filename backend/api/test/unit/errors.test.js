import { describe, it, expect } from 'vitest'
import {
  AppError,
  NotFoundError,
  ValidationError,
  UnauthorizedError,
} from '../../src/utils/errors.js'

describe('errors', () => {
  describe('AppError', () => {
    it('carries the status code and its own name', () => {
      const err = new AppError('boom', 418)
      expect(err.message).toBe('boom')
      expect(err.statusCode).toBe(418)
      expect(err.name).toBe('AppError')
      expect(err).toBeInstanceOf(Error)
    })

    it('captures a stack trace', () => {
      const err = new AppError('stack test', 500)
      expect(err.stack).toBeDefined()
      expect(err.stack.length).toBeGreaterThan(0)
    })

    it('uses constructor name as error name', () => {
      const err = new AppError('named', 500)
      expect(err.name).toBe('AppError')
    })
  })

  describe('NotFoundError', () => {
    it('defaults to 404 with a default message', () => {
      const err = new NotFoundError()
      expect(err.statusCode).toBe(404)
      expect(err.message).toBe('Not Found')
      expect(err.name).toBe('NotFoundError')
    })

    it('accepts a custom message', () => {
      const err = new NotFoundError('No such order')
      expect(err.message).toBe('No such order')
      expect(err.statusCode).toBe(404)
    })

    it('is an instance of Error', () => {
      expect(new NotFoundError()).toBeInstanceOf(Error)
    })
  })

  describe('ValidationError', () => {
    it('defaults to 400', () => {
      const err = new ValidationError()
      expect(err.statusCode).toBe(400)
      expect(err.message).toBe('Validation Error')
    })

    it('accepts a custom message', () => {
      const err = new ValidationError('field x is required')
      expect(err.message).toBe('field x is required')
      expect(err.statusCode).toBe(400)
    })
  })

  describe('UnauthorizedError', () => {
    it('defaults to 401', () => {
      const err = new UnauthorizedError()
      expect(err.statusCode).toBe(401)
      expect(err.message).toBe('Unauthorized')
    })

    it('accepts a custom message', () => {
      const err = new UnauthorizedError('token expired')
      expect(err.message).toBe('token expired')
      expect(err.statusCode).toBe(401)
    })
  })

  it('error subclasses are instances of AppError', () => {
    expect(new NotFoundError()).toBeInstanceOf(AppError)
    expect(new ValidationError()).toBeInstanceOf(AppError)
    expect(new UnauthorizedError()).toBeInstanceOf(AppError)
  })

  it('all subclasses are catchable as Error', () => {
    const errs = [new NotFoundError(), new ValidationError(), new UnauthorizedError()]
    for (const err of errs) {
      let caught
      try { throw err } catch (e) { caught = true; expect(e).toBe(err) }
      expect(caught).toBe(true)
    }
  })
})
