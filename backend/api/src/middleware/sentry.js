import * as Sentry from "@sentry/node";
import logger from "./logger.js";

const SENTRY_ERROR_FILTERS = [
  { code: "ECONNRESET", level: "warn" },
  { code: "ECONNREFUSED", level: "warn" },
  { code: "ETIMEDOUT", level: "warn" },
];

export function shouldIgnoreError(err) {
  return SENTRY_ERROR_FILTERS.some((f) => err.code === f.code);
}

export function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || "development",
    beforeSend(event) {
      if (event.exception?.values?.[0]?.value) {
        const err = new Error(event.exception.values[0].value);
        err.code = event.exception.values[0].type || undefined;
        if (shouldIgnoreError(err)) return null;
      }
      return event;
    },
  });
  logger.info("Sentry error tracking initialized.");
}

export async function flushSentry(timeoutMs = 2000) {
  if (!process.env.SENTRY_DSN) return;
  try {
    await Sentry.flush(timeoutMs);
  } catch (err) {
    logger.warn({ err }, "Sentry.flush failed during teardown");
  }
}

export function sentryRequestHandler() {
  if (typeof Sentry.Handlers?.requestHandler === 'function') {
    return Sentry.Handlers.requestHandler();
  }
  return (req, res, next) => next();
}

export function captureException(err) {
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(err);
  }
}

export function sentryErrorHandler() {
  if (typeof Sentry.Handlers?.errorHandler === 'function') {
    return Sentry.Handlers.errorHandler();
  }
  return Sentry.expressErrorHandler();
}
