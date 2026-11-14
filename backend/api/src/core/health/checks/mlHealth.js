import { HealthStatus, executeCheck } from '../HealthCheck.js';

const NAME = 'ml_engine';
const ML_HEALTH_TIMEOUT_MS = 3000;

const ML_ENGINE_URL = process.env.ML_ENGINE_URL || 'http://localhost:8001';

async function check(timeoutMs = ML_HEALTH_TIMEOUT_MS) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(`${ML_ENGINE_URL}/health`, { signal: controller.signal });
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
  } catch (err) {
    if (timedOut || err.name === 'AbortError' || err.name === 'TimeoutError') {
      return {
        status: HealthStatus.UNHEALTHY,
        message: `healthcheck timeout after ${timeoutMs}ms`,
      };
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export default function mlHealth(opts) {
  return executeCheck(
    NAME,
    () => check(opts?.timeoutMs ?? ML_HEALTH_TIMEOUT_MS),
    { critical: false, timeoutMs: ML_HEALTH_TIMEOUT_MS, ...opts }
  );
}
