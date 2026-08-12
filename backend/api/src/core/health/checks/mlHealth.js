import { HealthStatus, executeCheck, withTimeout } from '../HealthCheck.js';

const NAME = 'ml_engine';
const ML_HEALTH_TIMEOUT_MS = 3000;

const ML_ENGINE_URL = process.env.ML_ENGINE_URL || 'http://localhost:8001';

async function check() {
  const response = await withTimeout(fetch(`${ML_ENGINE_URL}/health`), ML_HEALTH_TIMEOUT_MS);
  if (!response.ok) {
    return { status: HealthStatus.UNHEALTHY, message: `HTTP ${response.status}` };
  }
  const data = await response.json();
  return {
    status: data.status === 'healthy' ? HealthStatus.HEALTHY : HealthStatus.DEGRADED,
    metadata: {
      modelsLoaded: data.models_loaded,
      service: data.service,
    },
  };
}

export default function mlHealth(opts) {
  return executeCheck(NAME, check, { critical: false, timeoutMs: ML_HEALTH_TIMEOUT_MS, ...opts });
}
