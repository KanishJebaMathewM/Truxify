import { HealthStatus, executeCheck, withTimeout } from '../HealthCheck.js';
import logger from '../../../middleware/logger.js';

const NAME = 'graphql';
const GRAPHQL_HEALTH_TIMEOUT_MS = 3000;

async function check() {
  const port = process.env.GRAPHQL_PORT || 4000;
  try {
    const url = `http://localhost:${port}/.well-known/apollo/server-health`;
    const response = await withTimeout(fetch(url), GRAPHQL_HEALTH_TIMEOUT_MS);
    if (response.ok) {
      return { status: HealthStatus.HEALTHY, metadata: { port } };
    }
    return { status: HealthStatus.DEGRADED, message: `HTTP ${response.status}` };
  } catch (err) {
    if (err.message?.includes('not_configured') || err.message?.includes('fetch failed') || err.code === 'ECONNREFUSED') {
      return { status: HealthStatus.DEGRADED, message: 'not_reachable' };
    }
    return { status: HealthStatus.UNHEALTHY, message: err.message };
  }
}

export default function graphqlHealth(opts) {
  return executeCheck(NAME, check, { critical: false, timeoutMs: GRAPHQL_HEALTH_TIMEOUT_MS, ...opts });
}
