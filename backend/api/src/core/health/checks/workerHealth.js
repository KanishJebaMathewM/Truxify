import { HealthStatus, executeCheck } from '../HealthCheck.js';

const NAME = 'workers';

function check() {
  const registeredWorkers = globalThis.__truxify_workers;
  const activeWorkers = [];
  if (registeredWorkers && typeof registeredWorkers === 'object') {
    for (const [name, running] of Object.entries(registeredWorkers)) {
      activeWorkers.push({ name, running });
    }
  }

  if (activeWorkers.length === 0) {
    // No worker states were registered: fail closed instead of reporting a
    // process with no running background workers as healthy.
    return {
      status: HealthStatus.UNHEALTHY,
      message: 'no_registered_workers',
      metadata: { workerCount: 0 },
    };
  }

  const allRunning = activeWorkers.every((w) => w.running);
  return {
    status: allRunning ? HealthStatus.HEALTHY : HealthStatus.DEGRADED,
    metadata: {
      workerCount: activeWorkers.length,
      workers: activeWorkers,
    },
  };
}

export default function workerHealth(opts) {
  return executeCheck(NAME, check, { critical: false, ...opts });
}
