import { describe, it, expect } from 'vitest';
import { AppError, NotFoundError, ValidationError, UnauthorizedError } from '../../../src/utils/errors.js';

describe('AppError', () => {
  it('extends Error', () => {
    const err = new AppError('test', 500);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
  });

  it('sets message and statusCode', () => {
    const err = new AppError('Something went wrong', 503);
    expect(err.message).toBe('Something went wrong');
    expect(err.statusCode).toBe(503);
  });

  it('has correct name', () => {
    const err = new AppError('test', 500);
    expect(err.name).toBe('AppError');
  });

  it('captures stack trace', () => {
    const err = new AppError('test', 500);
    expect(err.stack).toBeTruthy();
  });
});

describe('NotFoundError', () => {
  it('extends AppError', () => {
    const err = new NotFoundError();
    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(Error);
  });

  it('defaults to 404 status code', () => {
    const err = new NotFoundError();
    expect(err.statusCode).toBe(404);
  });

  it('accepts custom message', () => {
    const err = new NotFoundError('Driver not found');
    expect(err.message).toBe('Driver not found');
    expect(err.statusCode).toBe(404);
  });

  it('has correct name', () => {
    const err = new NotFoundError();
    expect(err.name).toBe('NotFoundError');
  });
});

describe('ValidationError', () => {
  it('extends AppError with 400 status', () => {
    const err = new ValidationError();
    expect(err.statusCode).toBe(400);
    expect(err).toBeInstanceOf(AppError);
  });

  it('accepts custom message', () => {
    const err = new ValidationError('Invalid email address');
    expect(err.message).toBe('Invalid email address');
  });
});

describe('UnauthorizedError', () => {
  it('extends AppError with 401 status', () => {
    const err = new UnauthorizedError();
    expect(err.statusCode).toBe(401);
    expect(err).toBeInstanceOf(AppError);
  });

  it('accepts custom message', () => {
    const err = new UnauthorizedError('Token expired');
    expect(err.message).toBe('Token expired');
  });
});
