import { HealthStatus, executeCheck } from '../HealthCheck.js';

const NAME = 'workers';

function check() {
  const activeWorkers = [];
  if (globalThis.__truxify_workers) {
    for (const [name, running] of Object.entries(globalThis.__truxify_workers)) {
      activeWorkers.push({ name, running });
    }
  }

  if (activeWorkers.length === 0) {
    return {
      status: HealthStatus.HEALTHY,
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
