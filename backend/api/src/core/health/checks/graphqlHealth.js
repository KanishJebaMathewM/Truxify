import { HealthStatus, executeCheck } from '../HealthCheck.js';
import logger from '../../../middleware/logger.js';

const NAME = 'graphql';
const GRAPHQL_HEALTH_TIMEOUT_MS = 3000;

async function check(timeoutMs = GRAPHQL_HEALTH_TIMEOUT_MS) {
  const port = process.env.GRAPHQL_PORT || 4000;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`healthcheck timeout after ${timeoutMs}ms`)),
    timeoutMs
  );
  try {
    const url = `http://localhost:${port}/.well-known/apollo/server-health`;
    const response = await fetch(url, { signal: controller.signal });
    if (response.ok) {
      return { status: HealthStatus.HEALTHY, metadata: { port } };
    }
    return { status: HealthStatus.DEGRADED, message: `HTTP ${response.status}` };
  } catch (err) {
    if (err.name === 'AbortError' || err.name === 'TimeoutError') {
      return { status: HealthStatus.UNHEALTHY, message: err.message || 'healthcheck timeout' };
    }
    if (err.message?.includes('not_configured') || err.message?.includes('fetch failed') || err.code === 'ECONNREFUSED') {
      return { status: HealthStatus.DEGRADED, message: 'not_reachable' };
    }
    return { status: HealthStatus.UNHEALTHY, message: err.message };
  } finally {
    clearTimeout(timer);
  }
}

export default function graphqlHealth(opts) {
  return executeCheck(
    NAME,
    () => check(opts?.timeoutMs ?? GRAPHQL_HEALTH_TIMEOUT_MS),
    { critical: false, timeoutMs: GRAPHQL_HEALTH_TIMEOUT_MS, ...opts }
  );
}
