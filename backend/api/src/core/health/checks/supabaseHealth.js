import { supabase, supabaseAdmin } from '../../../config/db.js';
import { HealthStatus, executeCheck } from '../HealthCheck.js';

const NAME = 'supabase';

async function check() {
  // Probe through the service-role client: the shipped schema revokes anon
  // privileges on profiles (revoke_anon_privileges.sql), so an anon-keyed
  // probe always reports 42501 permission denied even when Supabase is up.
  const client = supabaseAdmin || supabase;
  if (!client) {
    return { status: HealthStatus.UNHEALTHY, message: 'not_configured' };
  }
  const { error } = await client.from('profiles').select('id').limit(1);
  if (error) {
    return { status: HealthStatus.UNHEALTHY, message: error.message };
  }
  return { status: HealthStatus.HEALTHY };
}

export default function supabaseHealth(opts) {
  return executeCheck(NAME, check, { critical: true, ...opts });
}
