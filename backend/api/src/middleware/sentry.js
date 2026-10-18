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
  const base =
    typeof Sentry.Handlers?.requestHandler === 'function'
      ? Sentry.Handlers.requestHandler()
      : (req, res, next) => next();
  return (req, res, next) => {
    if (req.user) {
      Sentry.setUser({
        id: req.user.id,
        email: req.user.email,
        role: req.user.role,
      });
    }
    return base(req, res, next);
  };
}

export function captureException(err) {
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(err);
  }
}

export function captureDebugException(err) {
  if (!process.env.SENTRY_DSN) return null;
  return Sentry.withScope((scope) => {
    scope.setTag('debug', 'true');
    return Sentry.captureException(err);
  });
}

export function sentryErrorHandler() {
  const base =
    typeof Sentry.Handlers?.errorHandler === 'function'
      ? Sentry.Handlers.errorHandler()
      : typeof Sentry.expressErrorHandler === 'function'
        ? Sentry.expressErrorHandler()
        : (err, req, res, next) => next(err);
  return (err, req, res, next) => {
    Sentry.captureException(err);
    return base(err, req, res, next);
  };
}
