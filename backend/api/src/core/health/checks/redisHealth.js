import { redisClient } from '../../../config/db.js';
import { HealthStatus, executeCheck } from '../HealthCheck.js';

const NAME = 'redis';

async function check() {
  if (!redisClient) {
    return { status: HealthStatus.UNHEALTHY, message: 'not_configured' };
  }
  const reply = await redisClient.ping();
  if (reply !== 'PONG') {
    return { status: HealthStatus.UNHEALTHY, message: `unexpected reply: ${reply}` };
  }
  return { status: HealthStatus.HEALTHY };
}

export default function redisHealth(opts) {
  return executeCheck(NAME, check, { critical: false, ...opts });
}
