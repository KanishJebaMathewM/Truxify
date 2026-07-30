import { HealthStatus, executeCheck } from '../HealthCheck.js';

const NAME = 'polygon';

function check() {
  if (!process.env.POLYGON_RPC_URL) {
    return { status: HealthStatus.UNHEALTHY, message: 'not_configured' };
  }
  return {
    status: HealthStatus.HEALTHY,
    metadata: {
      rpcUrl: process.env.POLYGON_RPC_URL.replace(/\/\/.*@/, '//***@'),
    },
  };
}

export default function polygonHealth(opts) {
  return executeCheck(NAME, check, { critical: false, ...opts });
}
