// backend/api/src/middleware/logger.js
import { logger } from '../lib/logger.js';
import { correlationContext } from './correlationId.js';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'];

function sanitizeLogLevel(level) {
  return LOG_LEVELS.includes(level) ? level : 'info';
}

export { LOG_LEVELS, sanitizeLogLevel, logger, correlationContext };
export default logger;
