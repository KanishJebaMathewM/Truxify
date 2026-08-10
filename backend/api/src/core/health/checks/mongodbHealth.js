import { mongoDb } from '../../../config/db.js';
import { HealthStatus, executeCheck } from '../HealthCheck.js';
import logger from '../../../middleware/logger.js';

const NAME = 'mongodb';

async function check() {
  if (!mongoDb) {
    return { status: HealthStatus.UNHEALTHY, message: 'not_configured' };
  }
  try {
    await mongoDb.admin().ping();
    return { status: HealthStatus.HEALTHY };
  } catch (err) {
    logger.error({ err: err.message, check: NAME }, 'MongoDB health probe failed');
    return { status: HealthStatus.UNHEALTHY, message: err.message };
  }
}

export default function mongodbHealth(opts) {
  return executeCheck(NAME, check, { critical: true, ...opts });
}
