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
  })

  describe('ValidationError', () => {
    it('defaults to 400', () => {
      const err = new ValidationError()
      expect(err.statusCode).toBe(400)
      expect(err.message).toBe('Validation Error')
    })
  })

  describe('UnauthorizedError', () => {
    it('defaults to 401', () => {
      const err = new UnauthorizedError()
      expect(err.statusCode).toBe(401)
      expect(err.message).toBe('Unauthorized')
    })
  })

  it('error subclasses are instances of AppError', () => {
    expect(new NotFoundError()).toBeInstanceOf(AppError)
    expect(new ValidationError()).toBeInstanceOf(AppError)
    expect(new UnauthorizedError()).toBeInstanceOf(AppError)
  })
})
