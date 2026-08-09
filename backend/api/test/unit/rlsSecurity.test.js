import { describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ALL_TABLES = [
  'profiles',
  'driver_details',
  'customer_stats',
  'trucks',
  'tyre_diagnostics',
  'truck_maintenance_tickets',
  'saved_addresses',
  'payment_methods',
  'documents',
  'orders',
  'order_timeline',
  'load_offers',
  'load_bids',
  'trips',
  'trip_items',
  'trip_stops',
  'route_map_points',
  'ratings',
  'wallet_transactions',
  'processed_batches',
  'demand_routes',
  'notifications',
  'faqs',
  'support_tickets',
  'earnings_daily',
  'delivery_otps',
  'driver_locations',
  'user_devices',
  'driver_documents',
  'vehicle_types',
  'regions',
  'webhook_failures',
  'tracking_tokens',
  'behavioral_profiles',
  'fraud_risk_scores',
  'fraud_review_queue',
];

// Tables with RLS policies in the main RLS migration (20240101000000_rls.sql).
// user_devices, driver_documents, webhook_failures, tracking_tokens, and the
// fraud tables have RLS in their own individual migrations.
const MAIN_RLS_TABLES = ALL_TABLES.filter(
  (t) => !['user_devices', 'driver_documents', 'webhook_failures', 'tracking_tokens', 'behavioral_profiles', 'fraud_risk_scores', 'fraud_review_queue'].includes(t)
);

describe('RLS Migration (20240101000000_rls.sql)', () => {
  let rlsContent;

  beforeAll(async () => {
    const rlsPath = path.resolve(__dirname, '../../../../supabase/migrations/20240101000000_rls.sql');
    rlsContent = await fs.readFile(rlsPath, 'utf8');
  });

  it.each(MAIN_RLS_TABLES)('enables RLS on table: %s', (table) => {
    const pattern = new RegExp(
      `ALTER TABLE IF EXISTS ${table}\\s+ENABLE ROW LEVEL SECURITY`,
      'i'
    );
    expect(pattern.test(rlsContent)).toBe(true);
  });

  it.each(MAIN_RLS_TABLES)('has a service_role full-access policy on %s', (table) => {
    const pattern = new RegExp(
      `CREATE POLICY "Service role full access on ${table}"\\s+ON ${table}\\s+FOR ALL TO service_role`,
      'i'
    );
    expect(pattern.test(rlsContent)).toBe(true);
  });

  it('has three distinct per-role policies on profiles (SELECT, INSERT, UPDATE)', () => {
    const selectPolicy = /CREATE POLICY "Users select own profile"\s+ON profiles FOR SELECT TO authenticated/i;
    const insertPolicy = /CREATE POLICY "Users insert own profile"\s+ON profiles FOR INSERT TO authenticated/i;
    const updatePolicy = /CREATE POLICY "Users update own profile"\s+ON profiles FOR UPDATE TO authenticated/i;
    expect(selectPolicy.test(rlsContent)).toBe(true);
    expect(insertPolicy.test(rlsContent)).toBe(true);
    expect(updatePolicy.test(rlsContent)).toBe(true);
  });

  it('gives drivers read access to assigned orders, and customers full access to own orders', () => {
    expect(
      /CREATE POLICY "Customers access own orders"\s+ON orders FOR ALL TO authenticated/i.test(rlsContent)
    ).toBe(true);
    expect(
      /CREATE POLICY "Drivers view assigned orders"\s+ON orders FOR SELECT TO authenticated\s+USING \(driver_id = get_profile_id\(\)\)/i.test(rlsContent)
    ).toBe(true);
  });

  it('allows anon SELECT on public reference tables (faqs, vehicle_types, regions)', () => {
    expect(/CREATE POLICY "Anyone can view active FAQs"\s+ON faqs FOR SELECT TO anon, authenticated/i.test(rlsContent)).toBe(true);
    expect(/CREATE POLICY "Anyone can view vehicle types"\s+ON vehicle_types FOR SELECT TO anon, authenticated/i.test(rlsContent)).toBe(true);
    expect(/CREATE POLICY "Anyone can view regions"\s+ON regions FOR SELECT TO anon, authenticated/i.test(rlsContent)).toBe(true);
  });

  it('restricts delivery_otps: drivers blocked, customers see own, service_role write', () => {
    expect(/CREATE POLICY "Drivers cannot select delivery OTPs"\s+ON delivery_otps FOR SELECT TO authenticated\s+USING \(false\)/i.test(rlsContent)).toBe(true);
    expect(/CREATE POLICY "Customers view own delivery OTPs"\s+ON delivery_otps FOR SELECT TO authenticated/i.test(rlsContent)).toBe(true);
    expect(/CREATE POLICY "service_insert_delivery_otp"\s+ON delivery_otps FOR INSERT TO service_role/i.test(rlsContent)).toBe(true);
  });

  it('defines the get_profile_id() helper function', () => {
    expect(/CREATE OR REPLACE FUNCTION get_profile_id\(\)/i.test(rlsContent)).toBe(true);
    expect(/firebase_uid = \(auth\.jwt\(\) ->> 'sub'\)/.test(rlsContent)).toBe(true);
  });
});

describe('Individual migration files with RLS policies', () => {
  it('user_devices migration has RLS policies (20260623142000)', async () => {
    const p = path.resolve(__dirname, '../../../../supabase/migrations/20260623142000_create_user_devices.sql');
    const content = await fs.readFile(p, 'utf8');
    expect(content).toMatch(/ALTER TABLE user_devices ENABLE ROW LEVEL SECURITY/i);
    expect(content).toMatch(/CREATE POLICY "Service role full access on user_devices"/);
    expect(content).toMatch(/CREATE POLICY "Users access own user_devices"/);
  });

  it('driver_documents migration has RLS policies (20260702000000)', async () => {
    const p = path.resolve(__dirname, '../../../../supabase/migrations/20260702000000_create_driver_documents.sql');
    const content = await fs.readFile(p, 'utf8');
    expect(content).toMatch(/ALTER TABLE driver_documents ENABLE ROW LEVEL SECURITY/i);
    expect(content).toMatch(/CREATE POLICY "Service role full access on driver_documents"/);
    expect(content).toMatch(/CREATE POLICY "Drivers read own driver_documents"/);
  });

  it('webhook_failures migration has RLS (20260710000000)', async () => {
    const p = path.resolve(__dirname, '../../../../supabase/migrations/20260710000000_create_webhook_failures.sql');
    const content = await fs.readFile(p, 'utf8');
    expect(content).toMatch(/ALTER TABLE webhook_failures ENABLE ROW LEVEL SECURITY/i);
    expect(content).toMatch(/CREATE POLICY "Allow Service Role full access to webhook_failures"/);
  });

  it('tracking_tokens migration has RLS and customer SELECT policy (20260716000000)', async () => {
    const p = path.resolve(__dirname, '../../../../supabase/migrations/20260716000000_add_public_tracking_tokens.sql');
    const content = await fs.readFile(p, 'utf8');
    expect(content).toMatch(/alter table tracking_tokens enable row level security/i);
    expect(content).toMatch(/create policy "Service role full access on tracking_tokens"/i);
    expect(content).toMatch(/create policy "Customers select own tracking tokens"/i);
  });
});

describe('RLS ownership policies compare profile ids, not auth.uid() (issue #5852)', () => {
  const readMigration = (name) =>
    readFileSync(path.resolve(__dirname, `../../../../supabase/migrations/${name}`), 'utf8');

  it('bids migration uses get_profile_id() for driver and customer ownership policies', () => {
    const content = readMigration('20260730120000_create_bids_table.sql');
    expect(content).toMatch(/USING \(get_profile_id\(\) = driver_id\)/);
    expect(content).toMatch(/WITH CHECK \(get_profile_id\(\) = driver_id\)/);
    expect(content).toMatch(/USING \(get_profile_id\(\) = driver_id AND status = 'pending'\)/);
    expect(content).toMatch(/lo\.customer_id = get_profile_id\(\)/);
    expect(content).not.toMatch(/auth\.uid\(\)/);
  });

  it('application_audit_logs admin-read policy resolves the profile via get_profile_id()', () => {
    const content = readMigration('20260723000010_create_application_audit_logs.sql');
    expect(content).toMatch(/profiles\.id = get_profile_id\(\)/);
    expect(content).not.toMatch(/auth\.uid\(\)/);
  });

  it('cold chain telemetry policy uses get_profile_id() for load ownership checks', () => {
    const content = readMigration('20260721000000_add_cold_chain_telemetry.sql');
    expect(content).toMatch(/load_offers\.customer_id = get_profile_id\(\) OR load_offers\.driver_id = get_profile_id\(\)/);
    expect(content).not.toMatch(/auth\.uid\(\) = [a-z_]+_id/);
  });
});

describe('Revoke anon privileges (revoke_anon_privileges.sql)', () => {
  let revokeContent;

  beforeAll(async () => {
    const revokePath = path.resolve(__dirname, '../../../../supabase/migrations/revoke_anon_privileges.sql');
    revokeContent = await fs.readFile(revokePath, 'utf8');
  });

  it.each(ALL_TABLES)('revokes anon privileges on table: %s', (table) => {
    expect(revokeContent).toContain(`REVOKE ALL ON TABLE public.${table} FROM anon`);
  });
});

describe('Admin role on profiles (issue #5848)', () => {
  let migrationContent;
  let setupContent;
  let auditLogContent;

  beforeAll(async () => {
    const migrationPath = path.resolve(__dirname, '../../../../supabase/migrations/20260802160000_add_admin_role_to_profiles.sql');
    migrationContent = await fs.readFile(migrationPath, 'utf8');
    const setupPath = path.resolve(__dirname, '../../../../docs/supabase_setup.sql');
    setupContent = await fs.readFile(setupPath, 'utf8');
    const auditPath = path.resolve(__dirname, '../../../../supabase/migrations/20260723000010_create_application_audit_logs.sql');
    auditLogContent = await fs.readFile(auditPath, 'utf8');
  });

  it('adds admin to the profiles.role CHECK constraint in a migration', () => {
    expect(migrationContent).toMatch(/ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check/i);
    expect(migrationContent).toMatch(/CHECK \(role IN \('customer', 'driver', 'admin'\)\)/i);
  });

  it('updates the canonical profiles.role constraint in docs/supabase_setup.sql', () => {
    expect(setupContent).toMatch(/role\s+text\s+not\s+null\s+check\s*\(\s*role\s+in\s*\(\s*'customer'\s*,\s*'driver'\s*,\s*'admin'\s*\)\s*\)/i);
  });

  it('keeps the audit-logs admin-read policy on role = \'admin\', which is now satisfiable', () => {
    expect(auditLogContent).toMatch(/CREATE POLICY "Admins can read audit logs"/i);
    expect(auditLogContent).toMatch(/profiles\.role = 'admin'/i);
  });
});

describe('RPC Security Fix (20260708000000_fix_rpc_security.sql)', () => {
  let fixContent;

  beforeAll(async () => {
    const fixPath = path.resolve(__dirname, '../../../../supabase/migrations/20260708000000_fix_rpc_security.sql');
    fixContent = await fs.readFile(fixPath, 'utf8');
  });

  it('restores auth.uid() check on accept_bid_tx', () => {
    expect(
      /IF auth\.uid\(\) <> v_customer_id THEN\s+RAISE EXCEPTION 'Unauthorized: you can only accept bids on your own orders'/i.test(fixContent)
    ).toBe(true);
  });

  it('restricts claim_refund_reconciliation to service_role', () => {
    expect(/IF auth\.role\(\) <> 'service_role' THEN\s+RAISE EXCEPTION 'Only the backend service can claim refund reconciliation rows'/i.test(fixContent)).toBe(true);
  });

  it('restricts claim_release_reconciliation to service_role', () => {
    expect(/IF auth\.role\(\) <> 'service_role' THEN\s+RAISE EXCEPTION 'Only the backend service can claim release reconciliation rows'/i.test(fixContent)).toBe(true);
  });

  it('sets search_path on claim_refund_reconciliation', () => {
    expect(/SET search_path = public, pg_temp/i.test(fixContent)).toBe(true);
  });

  it('sets search_path on claim_release_reconciliation', () => {
    expect(/SET search_path = public, pg_temp/i.test(fixContent)).toBe(true);
  });
});

describe('accept_bid_tx — auth.uid() verification present in migration chain', () => {
  let secureRpcContent;

  beforeAll(async () => {
    const path2 = path.resolve(__dirname, '../../../../supabase/migrations/20260706075009_secure_rpc_search_path.sql');
    secureRpcContent = await fs.readFile(path2, 'utf8');
  });

  it('the 20260706075009 version of accept_bid_tx has auth.uid() check restored', () => {
    // The 20260706075009 migration restores auth.uid() in accept_bid_tx,
    // ensuring only the order's customer can accept bids.
    const hasAuthCheck = /IF auth\.uid\(\) <> v_customer_id THEN/i.test(secureRpcContent);
    expect(hasAuthCheck).toBe(true);
  });

  it('complete_trip_tx has auth.uid() check verifying driver assignment', () => {
    const hasAuthCheck = /IF auth\.uid\(\) <> v_order.driver_id THEN/i.test(secureRpcContent);
    expect(hasAuthCheck).toBe(true);
  });

  it('withdraw_funds_tx has auth.uid() check verifying caller owns the wallet', () => {
    const hasAuthCheck = /IF auth\.uid\(\) <> p_driver_id THEN/i.test(secureRpcContent);
    expect(hasAuthCheck).toBe(true);
  });
});

describe('complete_trip_tx — order-linked trip finalization (issue #5756)', () => {
  it('the 20260704000001 migration selects the trip by order_id and raises when none exists', async () => {
    const p = path.resolve(__dirname, '../../../../supabase/migrations/20260704000001_add_auth_verification_to_complete_trip_tx.sql');
    const content = await fs.readFile(p, 'utf8');

    expect(/select\s+trip_display_id\s+into\s+v_trip_display_id\s+from\s+trips\s+where\s+order_id\s*=\s*p_order_id/i.test(content)).toBe(true);
    expect(/if\s+v_trip_display_id\s+is\s+null[\s\S]*raise\s+exception[\s\S]*no\s+active\s+trip\s+found/i.test(content)).toBe(true);
    expect(/v_active_trip_count/i.test(content)).toBe(false);
  });

  it('the link_trips_to_orders migration adds an order_id FK to trips and recreates complete_trip_tx', async () => {
    const p = path.resolve(__dirname, '../../../../supabase/migrations/20260802060000_link_trips_to_orders.sql');
    const content = await fs.readFile(p, 'utf8');

    expect(/alter\s+table\s+trips\s+add\s+column\s+if\s+not\s+exists\s+order_id\s+uuid\s+references\s+orders\s*\(\s*id\s*\)/i.test(content)).toBe(true);
    expect(/create\s+index\s+if\s+not\s+exists\s+idx_trips_order_id\s+on\s+trips\s*\(\s*order_id\s*\)/i.test(content)).toBe(true);
    expect(/select\s+trip_display_id\s+into\s+v_trip_display_id\s+from\s+trips\s+where\s+order_id\s*=\s*p_order_id/i.test(content)).toBe(true);
    expect(/if\s+v_trip_display_id\s+is\s+null[\s\S]*raise\s+exception[\s\S]*no\s+active\s+trip\s+found/i.test(content)).toBe(true);
  });
});

describe('Service-level RPC calls carry an authenticated client (issue #5737)', () => {
  const base = path.resolve(__dirname, '../../src');
  const readSource = (rel) => readFileSync(path.resolve(base, rel), 'utf8');

  // Extract every `executeRpc('<rpc_name>', {...}, <client>)` invocation block
  // so we can assert each one passes an explicit client rather than relying on
  // the repository defaulting to the shared anon-key client.
  function rpcCallBlocks(content) {
    const blocks = [];
    const re = /executeRpc\(\s*'([a-z_0-9]+)'/g;
    let match;
    while ((match = re.exec(content))) {
      // The regex consumed the opening '(' of executeRpc, so start at depth 1;
      // the balanced closing ')' brings the count back to 0.
      let depth = 1;
      let i = re.lastIndex;
      for (; i < content.length; i++) {
        const ch = content[i];
        if (ch === '(') depth += 1;
        else if (ch === ')') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      blocks.push({ rpc: match[1], block: content.slice(match.index, i + 1) });
    }
    return blocks;
  }

  it('executeRpc requires an explicit client instead of falling back to the shared anon-key client', () => {
    const orderRepositoryContent = readSource('repositories/orderRepository.js');
    const executeRpcMethod = orderRepositoryContent.match(/async executeRpc\(name, params, client\)[\s\S]*?\n\s{2}\}/)[0];
    expect(executeRpcMethod).toMatch(/if \(!client\)\s*\{\s*throw new Error/);
    expect(executeRpcMethod).not.toMatch(/client \|\| this\.supabase/);
  });

  it.each(rpcCallBlocks(readSource('services/order/deliveryVerificationService.js')))(
    'deliveryVerificationService passes a client for $rpc',
    ({ block }) => {
      expect(block).toMatch(/,\s*(userClient|supabaseAdmin)\s*\)\s*;?$/);
    }
  );

  it.each(rpcCallBlocks(readSource('services/order/orderMilestoneService.js')))(
    'orderMilestoneService passes a client for $rpc',
    ({ block }) => {
      expect(block).toMatch(/,\s*(userClient|supabaseAdmin)\s*\)\s*;?$/);
    }
  );

  it.each(rpcCallBlocks(readSource('services/order/orderLifecycleService.js')))(
    'orderLifecycleService passes a client for $rpc',
    ({ block }) => {
      expect(block).toMatch(/,\s*(userClient(?:\s*\?\?\s*supabaseAdmin)?|supabaseAdmin)\s*\)\s*;?$/);
    }
  );

  it.each(rpcCallBlocks(readSource('routes/orderRoutes.js')))(
    'orderRoutes passes a client for $rpc',
    ({ block }) => {
      expect(block).toMatch(/,\s*(req\.token \? createUserClient\(req\.token\) : undefined|supabaseAdmin)\s*\)\s*;?$/);
    }
  );

  it('withdraw_funds_tx is invoked through a per-user client in driverRoutes, never the shared anon-key client', () => {
    const driverRoutesContent = readSource('routes/driverRoutes.js');
    expect(driverRoutesContent).toMatch(/createUserClient\(req\.token\)/);
    expect(driverRoutesContent).toMatch(/userClient\.rpc\('withdraw_funds_tx'/);
    expect(driverRoutesContent).not.toMatch(/createUserClient\(req\.token\) \? [^;]* : supabase/);
  });
});

describe('User-facing order data path uses the service-role client (issue #8885)', () => {
  const base = path.resolve(__dirname, '../../src');
  const readSource = (rel) => readFileSync(path.resolve(base, rel), 'utf8');

  it('container.js wires orderRepository, orderValidationService, and trackingTokenService to the service-role client', () => {
    const container = readSource('core/container.js');
    expect(container).toMatch(/const repoClient = supabaseAdmin \?\? supabase;/);
    expect(container).toMatch(/const orderRepository = new OrderRepository\(repoClient\);/);
    expect(container).toMatch(/const orderValidationService = new OrderValidationService\(\{ supabase: repoClient, logger \}\)/);
    expect(container).toMatch(/const trackingTokenService = new TrackingTokenService\(\{ supabase: repoClient, logger \}\)/);
    expect(container).not.toMatch(/const orderRepository = new OrderRepository\(supabase\);/);
  });
});

describe('update_order_and_load_offer invoked via the service-role client (issue #6335)', () => {
  const base = path.resolve(__dirname, '../../src');
  const readSource = (rel) => readFileSync(path.resolve(base, rel), 'utf8');

  function rpcBlock(content, rpcName) {
    const re = new RegExp(`executeRpc\\(\\s*'${rpcName}'`);
    const match = re.exec(content);
    if (!match) return null;
    let depth = 1;
    let i = match.index + match[0].length;
    for (; i < content.length; i++) {
      const ch = content[i];
      if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    return content.slice(match.index, i + 1);
  }

  it.each([
    ['services/order/orderLifecycleService.js', 'orderLifecycleService.js change-drop path'],
    ['routes/orderRoutes.js', 'orderRoutes.js change-drop route'],
  ])('%s invokes update_order_and_load_offer with supabaseAdmin, never the user client', (rel, label) => {
    const content = readSource(rel);
    const block = rpcBlock(content, 'update_order_and_load_offer');

    expect(block).toBeTruthy();
    expect(block).toMatch(/,\s*supabaseAdmin\s*\)\s*;?$/);
    expect(block).not.toMatch(/userClient/);
    expect(block).not.toMatch(/createUserClient/);
    expect(block).not.toMatch(/req\.token/);
  });

  it('orderRoutes.js imports supabaseAdmin from config/db.js', () => {
    const content = readSource('routes/orderRoutes.js');
    expect(content).toMatch(/import \{ [^}]*supabaseAdmin[^}]*\} from '\.\.\/config\/db\.js';/);
  });
});

describe('Fraud tables RLS (issue #6334)', () => {
  let migrationContent;
  let serviceContent;

  beforeAll(async () => {
    const migrationPath = path.resolve(__dirname, '../../../../supabase/migrations/20260805140000_harden_fraud_tables_rls.sql');
    migrationContent = await fs.readFile(migrationPath, 'utf8');
    const servicePath = path.resolve(__dirname, '../../src/services/fraud/FraudDetectionService.js');
    serviceContent = await fs.readFile(servicePath, 'utf8');
  });

  it.each([
    'behavioral_profiles_authenticated_all',
    'fraud_risk_scores_authenticated_all',
    'fraud_review_queue_authenticated_all',
  ])('drops the wide-open authenticated FOR ALL USING(true) policy: %s', (policy) => {
    expect(migrationContent).toMatch(new RegExp(`DROP POLICY IF EXISTS ${policy} ON`, 'i'));
    expect(migrationContent).not.toMatch(new RegExp(`CREATE POLICY ${policy}`, 'i'));
  });

  const policyName = (table) => table.replace(/_/g, ' ');

  it.each([
    'behavioral_profiles',
    'fraud_risk_scores',
    'fraud_review_queue',
  ])('grants admin-only SELECT on %s via get_profile_id() and profiles.role, without auth.uid()', (table) => {
    const adminSelect = new RegExp(
      `CREATE POLICY "Admins can read ${policyName(table)}"[\\s\\S]*?FOR SELECT[\\s\\S]*?profiles\\.id = get_profile_id\\(\\)[\\s\\S]*?profiles\\.role = 'admin'`,
      'i'
    );
    expect(adminSelect.test(migrationContent)).toBe(true);
    expect(migrationContent).not.toMatch(/auth\.uid\(\)/);
  });

  it.each([
    'behavioral_profiles',
    'fraud_risk_scores',
    'fraud_review_queue',
  ])('restricts writes on %s to service_role and denies authenticated UPDATE/DELETE', (table) => {
    const serviceWrite = new RegExp(
      `CREATE POLICY "Service role can write ${policyName(table)}"[\\s\\S]*?FOR ALL[\\s\\S]*?TO service_role`,
      'i'
    );
    expect(serviceWrite.test(migrationContent)).toBe(true);
    expect(migrationContent).toMatch(new RegExp(`No updates on ${policyName(table)}"[\\s\\S]*?FOR UPDATE[\\s\\S]*?USING \\(false\\)`, 'i'));
    expect(migrationContent).toMatch(new RegExp(`No deletes on ${policyName(table)}"[\\s\\S]*?FOR DELETE[\\s\\S]*?USING \\(false\\)`, 'i'));
  });

  it('FraudDetectionService persists through the service-role admin client, never the anon client', () => {
    expect(serviceContent).toMatch(/import \{ redisClient, supabaseAdmin \} from '\.\.\/\.\.\/config\/db\.js';/);
    expect(serviceContent).toMatch(/!supabaseAdmin\b/);
    expect(serviceContent).not.toMatch(/\bsupabase\s*\.\s*from/);
    expect(serviceContent).not.toMatch(/\bsupabase\s*\)/);
  });
});

describe('complete_trip_tx — authorization is not NULL-bypassable and is service-role-only (issue #6332)', () => {
  let content;

  beforeAll(async () => {
    const p = path.resolve(__dirname, '../../../../supabase/migrations/20260805120000_secure_complete_trip_tx_auth.sql');
    content = await fs.readFile(p, 'utf8');
  });

  it('does not use the NULL-bypassable guard (auth.uid() is not null and get_profile_id() <>)', () => {
    expect(/auth\.uid\(\)\s+is not null\s+and\s+get_profile_id\(\)\s+<>/.test(content)).toBe(false);
  });

  it('fails closed: non-service_role callers must resolve to the assigned driver (auth.role() + IS DISTINCT FROM)', () => {
    expect(/coalesce\(auth\.role\(\),\s*''\)\s+<> 'service_role'/.test(content)).toBe(true);
    expect(/get_profile_id\(\)\s+is distinct from\s+v_order\.driver_id/.test(content)).toBe(true);
    expect(/raise exception 'Unauthorized: you can only complete trips you are assigned to'/.test(content)).toBe(true);
  });

  it('revokes EXECUTE from PUBLIC, anon and authenticated so PostgREST clients cannot invoke it directly', () => {
    expect(/revoke execute on function complete_trip_tx\(uuid,\s*uuid,\s*text\)\s+from public,\s*anon,\s*authenticated/i.test(content)).toBe(true);
  });

  it('grants EXECUTE to service_role only', () => {
    expect(/grant execute on function complete_trip_tx\(uuid,\s*uuid,\s*text\)\s+to service_role/i.test(content)).toBe(true);
  });
});

describe('Secure Fraud Tables RLS (20260805174232_secure_fraud_tables_rls.sql)', () => {
  let content;

  beforeAll(async () => {
    const p = path.resolve(__dirname, '../../../../supabase/migrations/20260805174232_secure_fraud_tables_rls.sql');
    content = await fs.readFile(p, 'utf8');
  });

  it('drops existing overly permissive authenticated policies', () => {
    expect(/DROP POLICY IF EXISTS behavioral_profiles_authenticated_all ON public.behavioral_profiles/i.test(content)).toBe(true);
    expect(/DROP POLICY IF EXISTS fraud_risk_scores_authenticated_all ON public.fraud_risk_scores/i.test(content)).toBe(true);
    expect(/DROP POLICY IF EXISTS fraud_review_queue_authenticated_all ON public.fraud_review_queue/i.test(content)).toBe(true);
  });

  it('creates admin read-only policies for fraud tables', () => {
    expect(/CREATE POLICY "Admins can read behavioral_profiles"/i.test(content)).toBe(true);
    expect(/CREATE POLICY "Admins can read fraud_risk_scores"/i.test(content)).toBe(true);
    expect(/CREATE POLICY "Admins can read fraud_review_queue"/i.test(content)).toBe(true);

    // Ensure they restrict to admin role
    expect(/profiles\.role = 'admin'/i.test(content)).toBe(true);
  });
});
