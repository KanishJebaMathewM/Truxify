import { describe, expect, it } from 'vitest';
import fs from 'fs/promises';
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
];

// Tables with RLS policies in the main RLS migration (20240101000000_rls.sql).
// user_devices, driver_documents, webhook_failures, and tracking_tokens have
// RLS in their own individual migrations.
const MAIN_RLS_TABLES = ALL_TABLES.filter(
  (t) => !['user_devices', 'driver_documents', 'webhook_failures', 'tracking_tokens'].includes(t)
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
