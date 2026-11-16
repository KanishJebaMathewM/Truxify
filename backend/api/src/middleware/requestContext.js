import { randomUUID } from 'node:crypto';
import logger from './logger.js';

/**
 * Middleware to ensure every incoming request has a valid, traceable context ID.
 */
export function requestContext(req, res, next) {
  let sessionId = req.headers['x-session-id'] || req.sessionId || req.session?.id;

  // Guard against null, undefined, non-string, or empty/whitespace-only sessionId
  if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
    sessionId = `fallback-${randomUUID()}`;
    logger.debug('[RequestContext] Missing or invalid sessionId. Generated fallback ID:', sessionId);
  }

  // Attach sanitized, guaranteed sessionId to request context
  req.sessionId = sessionId;
  req.context = {
    ...req.context,
    sessionId,
  };

  next();
}

export default requestContext;
