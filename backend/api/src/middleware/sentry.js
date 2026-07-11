import * as Sentry from '@sentry/node';
import logger from './logger.js';

const SENTRY_ERROR_FILTERS = [
  { code: 'ECONNRESET', level: 'warn' },
  { code: 'ECONNREFUSED', level: 'warn' },
  { code: 'ETIMEDOUT', level: 'warn' },
];

function shouldIgnoreError(err) {
  return SENTRY_ERROR_FILTERS.some(f => err.code === f.code);
}

function getSentryLevel(err) {
  const filter = SENTRY_ERROR_FILTERS.find(f => err.code === f.code);
  return filter ? filter.level : 'error';
}

export function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    beforeSend(event) {
      if (event.exception?.values?.[0]?.value) {
        const err = new Error(event.exception.values[0].value);
        if (shouldIgnoreError(err)) return null;
      }
      return event;
    },
  });
  logger.info('Sentry error tracking initialized.');
}

export async function flushSentry(timeoutMs = 2000) {
  if (!process.env.SENTRY_DSN) return;
  try {
    await Sentry.flush(timeoutMs);
  } catch (err) {
    logger.warn({ err }, 'Sentry.flush failed during teardown');
  }
}

export function sentryErrorHandler() {
  return Sentry.expressErrorHandler();
}
