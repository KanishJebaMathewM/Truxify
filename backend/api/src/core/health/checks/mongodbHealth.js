import { mongoDb } from '../../../config/db.js';
import { HealthStatus, executeCheck } from '../HealthCheck.js';

const NAME = 'mongodb';

async function check() {
  if (!mongoDb) {
    return { status: HealthStatus.UNHEALTHY, message: 'not_configured' };
  }
  await mongoDb.admin().ping();
  return { status: HealthStatus.HEALTHY };
}

export default function mongodbHealth(opts) {
  return executeCheck(NAME, check, { critical: true, ...opts });
}
