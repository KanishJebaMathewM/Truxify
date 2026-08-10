import { supabase } from '../../../config/db.js';
import { HealthStatus, executeCheck } from '../HealthCheck.js';
import logger from '../../../middleware/logger.js';

const NAME = 'supabase';

async function check() {
  if (!supabase) {
    return { status: HealthStatus.UNHEALTHY, message: 'not_configured' };
  }
  const { error } = await supabase.from('profiles').select('id').limit(1);
  if (error) {
    logger.error({ err: error.message, check: NAME }, 'Supabase health probe failed');
    return { status: HealthStatus.UNHEALTHY, message: error.message };
  }
  return { status: HealthStatus.HEALTHY };
}

export default function supabaseHealth(opts) {
  return executeCheck(NAME, check, { critical: true, ...opts });
}
