import * as Sentry from '@sentry/node';
import logger from './logger.js';

export function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({ dsn, environment: process.env.NODE_ENV || 'development' });
  logger.info('Sentry error tracking initialized.');
}

export async function flushSentry(timeoutMs = 2000) {
  if (!process.env.SENTRY_DSN) return;
  try {
    await Sentry.flush(timeoutMs);
  } catch {
    // ignore flush errors during process teardown
  }
}

export function sentryErrorHandler() {
  return Sentry.expressErrorHandler();
}
