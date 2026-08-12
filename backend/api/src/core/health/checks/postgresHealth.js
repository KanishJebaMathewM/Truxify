import { pgPool } from '../../../config/db.js';
import { HealthStatus, executeCheck } from '../HealthCheck.js';

const NAME = 'postgres';

async function check() {
  if (!pgPool) {
    return { status: HealthStatus.UNHEALTHY, message: 'not_configured' };
  }
  const result = await pgPool.query('SELECT 1 AS ok');
  if (!result?.rows?.[0]?.ok) {
    return { status: HealthStatus.UNHEALTHY, message: 'unexpected query result' };
  }
  return { status: HealthStatus.HEALTHY, metadata: { poolTotalCount: pgPool.totalCount, poolIdleCount: pgPool.idleCount } };
}

export default function postgresHealth(opts) {
  return executeCheck(NAME, check, { critical: true, ...opts });
}
