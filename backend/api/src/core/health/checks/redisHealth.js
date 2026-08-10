import { redisClient } from '../../../config/db.js';
import { HealthStatus, executeCheck } from '../HealthCheck.js';
import logger from '../../../middleware/logger.js';

const NAME = 'redis';

async function check() {
  if (!redisClient) {
    return { status: HealthStatus.UNHEALTHY, message: 'not_configured' };
  }
  try {
    const reply = await redisClient.ping();
    if (reply !== 'PONG') {
      return { status: HealthStatus.UNHEALTHY, message: `unexpected reply: ${reply}` };
    }
    return { status: HealthStatus.HEALTHY };
  } catch (err) {
    logger.error({ err: err.message, check: NAME }, 'Redis health probe failed');
    return { status: HealthStatus.UNHEALTHY, message: err.message };
  }
}

export default function redisHealth(opts) {
  return executeCheck(NAME, check, { critical: false, ...opts });
}
