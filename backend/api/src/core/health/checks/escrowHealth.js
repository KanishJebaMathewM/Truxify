import { checkEscrowHealth } from '../../../services/escrow.js';
import { HealthStatus, executeCheck, withTimeout } from '../HealthCheck.js';
import logger from '../../../middleware/logger.js';

const NAME = 'escrow';
const ESCROW_CHECK_TIMEOUT_MS = 4000;

async function check() {
  try {
    const result = await withTimeout(checkEscrowHealth(), ESCROW_CHECK_TIMEOUT_MS);
    if (result.status === 'connected') {
      return { status: HealthStatus.HEALTHY, metadata: { chainId: result.chainId } };
    }
    if (result.status === 'not_configured') {
      return { status: HealthStatus.DEGRADED, message: 'not_configured' };
    }
    return { status: HealthStatus.UNHEALTHY, message: result.error || result.status };
  } catch (err) {
    logger.warn({ err: err.message, check: NAME }, 'Escrow health probe failed or timed out');
    return { status: HealthStatus.UNHEALTHY, message: err.message };
  }
}

export default function escrowHealth(opts) {
  return executeCheck(NAME, check, { critical: false, timeoutMs: ESCROW_CHECK_TIMEOUT_MS + 1000, ...opts });
}
