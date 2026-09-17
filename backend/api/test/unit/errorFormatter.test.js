import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { formatError } from '../../src/utils/errorFormatter.js';
import { AppError, NotFoundError, ValidationError } from '../../src/utils/errors.js';

describe('errorFormatter', () => {
  let env;

  beforeEach(() => {
    env = process.env.NODE_ENV;
  });

  afterEach(() => {
    process.env.NODE_ENV = env;
  });

  describe('API response schema consistency', () => {
    it('always returns success: false and an error object with code and message', () => {
      const result = formatError('ERR_CODE', 'Something went wrong');
      expect(result).toHaveProperty('success', false);
      expect(result).toHaveProperty('error');
      expect(typeof result.error.code).toBe('string');
      expect(typeof result.error.message).toBe('string');
    });
  });

  describe('formatting Error instances', () => {
    it('formats a standard Error instance', () => {
      const err = new Error('Connection refused');
      const result = formatError(err);
      expect(result).toEqual({
        success: false,
        error: {
          code: 'Error',
          message: 'Connection refused',
        },
      });
    });

    it('uses err.code if present on Error instance', () => {
      const err = new Error('Database timeout');
      err.code = 'ETIMEDOUT';
      const result = formatError(err);
      expect(result.error.code).toBe('ETIMEDOUT');
      expect(result.error.message).toBe('Database timeout');
    });

    it('formats custom AppError / ValidationError / NotFoundError subclasses', () => {
      const notFound = new NotFoundError('User profile not found');
      const resultNotFound = formatError(notFound);
      expect(resultNotFound.error.code).toBe('NotFoundError');
      expect(resultNotFound.error.message).toBe('User profile not found');

      const validation = new ValidationError('Payload invalid');
      const resultValidation = formatError(validation);
      expect(resultValidation.error.code).toBe('ValidationError');
      expect(resultValidation.error.message).toBe('Payload invalid');
    });

    it('includes Error details property when present in non-production', () => {
      process.env.NODE_ENV = 'development';
      const err = new Error('Validation failed');
      err.details = { field: 'email', reason: 'malformed' };
      const result = formatError(err);
      expect(result.error.details).toEqual({ field: 'email', reason: 'malformed' });
    });
  });

  describe('formatting plain objects', () => {
    it('extracts code, message, and details from plain object', () => {
      process.env.NODE_ENV = 'development';
      const input = {
        code: 'PAYMENT_FAILED',
        message: 'Insufficient balance',
        details: { balance: 0, required: 500 },
      };
      const result = formatError(input);
      expect(result).toEqual({
        success: false,
        error: {
          code: 'PAYMENT_FAILED',
          message: 'Insufficient balance',
          details: { balance: 0, required: 500 },
        },
      });
    });

    it('falls back to default code and message if omitted in object', () => {
      const input = {};
      const result = formatError(input);
      expect(result.error.code).toBe('INTERNAL_ERROR');
      expect(result.error.message).toBe('An error occurred');
    });
  });

  describe('handling null / undefined inputs', () => {
    it('handles empty / undefined arguments with safe defaults', () => {
      const result = formatError();
      expect(result).toEqual({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An error occurred',
        },
      });
    });

    it('handles null arguments gracefully', () => {
      const result = formatError(null, null, null);
      expect(result).toEqual({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An error occurred',
        },
      });
    });

    it('handles single string argument as both code and message', () => {
      const result = formatError('UNAUTHORIZED');
      expect(result.error.code).toBe('UNAUTHORIZED');
      expect(result.error.message).toBe('UNAUTHORIZED');
    });
  });

  describe('stacking multiple error fields and details', () => {
    it('stacks multiple validation errors in details array in development', () => {
      process.env.NODE_ENV = 'development';
      const errorList = [
        { field: 'origin_address', issue: 'Required field missing' },
        { field: 'destination_address', issue: 'Required field missing' },
        { field: 'truck_type', issue: 'Invalid truck type' },
      ];
      const result = formatError('VALIDATION_ERROR', 'Multiple validation failures', errorList);
      expect(result.error.details).toEqual(errorList);
      expect(result.error.details).toHaveLength(3);
    });

    it('stacks nested error objects in details in development', () => {
      process.env.NODE_ENV = 'development';
      const stackedDetails = {
        general: 'Order creation failed',
        fields: {
          capacity: { min: 1, max: 100, received: 0 },
          price: { min: 100, received: -50 },
        },
      };
      const result = formatError('INVALID_ORDER', 'Invalid order parameters', stackedDetails);
      expect(result.error.details).toEqual(stackedDetails);
      expect(result.error.details.fields.capacity.received).toBe(0);
    });

    it('strips all details in production environment', () => {
      process.env.NODE_ENV = 'production';
      const stackedDetails = {
        sensitiveStack: 'Error at line 42',
        databaseDetails: 'postgres://user:pass@host/db',
      };
      const result = formatError('DB_ERROR', 'Database error occurred', stackedDetails);
      expect(result.error.details).toBeUndefined();
      expect(result.error).not.toHaveProperty('details');
      expect(result).toEqual({
        success: false,
        error: {
          code: 'DB_ERROR',
          message: 'Database error occurred',
        },
      });
    });
  });
});
