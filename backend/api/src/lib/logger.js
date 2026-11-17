// backend/api/src/lib/logger.js
import winston from 'winston';
import { getCorrelationId } from './correlationContext.js';

// Custom format to automatically enrich log messages with the current correlationId
// if one exists in the asynchronous request context and was not passed explicitly
const correlationFormat = winston.format((info) => {
  try {
    const correlationId = getCorrelationId();
    if (correlationId && !info.correlationId) {
      info.correlationId = correlationId;
    }
  } catch (_err) {
    // Gracefully ignore if context is unavailable
  }
  return info;
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    correlationFormat(),
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [new winston.transports.Console()]
});

// Provide backward compatibility aliases
if (!logger.fatal) {
  logger.fatal = logger.error.bind(logger);
}
if (!logger.trace) {
  logger.trace = logger.debug.bind(logger);
}

export default logger;
