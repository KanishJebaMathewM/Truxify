import { checkEscrowHealth } from '../../../services/escrow.js';
import { HealthStatus, executeCheck } from '../HealthCheck.js';

const NAME = 'escrow';

async function check() {
  const result = await checkEscrowHealth();
  if (result.status === 'connected') {
    return { status: HealthStatus.HEALTHY, metadata: { chainId: result.chainId } };
  }
  if (result.status === 'not_configured') {
    return { status: HealthStatus.DEGRADED, message: 'not_configured' };
  }
  return { status: HealthStatus.UNHEALTHY, message: result.error || result.status };
}

export default function escrowHealth(opts) {
  return executeCheck(NAME, check, { critical: false, ...opts });
}
