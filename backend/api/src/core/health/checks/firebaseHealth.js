import { firebaseAdmin } from '../../../config/db.js';
import { HealthStatus, executeCheck } from '../HealthCheck.js';

const NAME = 'firebase';

function check() {
  if (!firebaseAdmin) {
    return { status: HealthStatus.DEGRADED, message: 'not_configured' };
  }
  return { status: HealthStatus.HEALTHY };
}

export default function firebaseHealth(opts) {
  return executeCheck(NAME, check, { critical: false, ...opts });
}
