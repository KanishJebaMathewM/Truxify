import { pgPool } from '../../../config/db.js';
import { HealthStatus, executeCheck } from '../HealthCheck.js';
import logger from '../../../middleware/logger.js';

const NAME = 'postgres';

async function check() {
  if (!pgPool) {
    return { status: HealthStatus.UNHEALTHY, message: 'not_configured' };
  }
  try {
    const result = await pgPool.query('SELECT 1 AS ok');
    if (!result?.rows?.[0]?.ok) {
      return { status: HealthStatus.UNHEALTHY, message: 'unexpected query result' };
    }
    return { status: HealthStatus.HEALTHY, metadata: { poolTotalCount: pgPool.totalCount, poolIdleCount: pgPool.idleCount } };
  } catch (err) {
    logger.error({ err: err.message, check: NAME }, 'Postgres health probe failed');
    return { status: HealthStatus.UNHEALTHY, message: err.message };
  }
}

export default function postgresHealth(opts) {
  return executeCheck(NAME, check, { critical: true, ...opts });
}
