import { describe, it, expect } from 'vitest';
import { AppError, NotFoundError, ValidationError, UnauthorizedError } from '../../../src/utils/errors.js';

describe('errors.js', () => {
  describe('AppError', () => {
    it('sets message and statusCode', () => {
      const err = new AppError('Test error', 500);
      expect(err.message).toBe('Test error');
      expect(err.statusCode).toBe(500);
      expect(err.name).toBe('AppError');
      expect(err).toBeInstanceOf(Error);
    });
  });

  describe('NotFoundError', () => {
    it('defaults to 404', () => {
      const err = new NotFoundError();
      expect(err.statusCode).toBe(404);
      expect(err.message).toBe('Not Found');
    });

    it('accepts custom message', () => {
      const err = new NotFoundError('User not found');
      expect(err.message).toBe('User not found');
      expect(err.statusCode).toBe(404);
    });
  });

  describe('ValidationError', () => {
    it('defaults to 400', () => {
      const err = new ValidationError();
      expect(err.statusCode).toBe(400);
      expect(err.message).toBe('Validation Error');
    });

    it('accepts custom message', () => {
      const err = new ValidationError('Invalid email');
      expect(err.message).toBe('Invalid email');
      expect(err.statusCode).toBe(400);
    });
  });

  describe('UnauthorizedError', () => {
    it('defaults to 401', () => {
      const err = new UnauthorizedError();
      expect(err.statusCode).toBe(401);
      expect(err.message).toBe('Unauthorized');
    });
  });
});
