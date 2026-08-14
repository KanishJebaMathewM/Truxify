import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Regression test for issue #13096: the `ratings` RLS policy must not allow a
// customer to fabricate ratings for an arbitrary `driver_id`. The hardened
// policy (introduced in 20260802030000_harden_submit_rating_tx.sql) constrains
// the WITH CHECK to a real order the customer owns, that was completed by the
// rated driver, and that is in a delivered/payment_released state.
describe('Ratings RLS constrains driver_id (issue #13096)', () => {
  const sql = readFileSync(
    path.resolve(
      __dirname,
      '../../../../supabase/migrations/20260802030000_harden_submit_rating_tx.sql'
    ),
    'utf8'
  );

  it('ties the ratings policy WITH CHECK to the rated driver and an eligible order', () => {
    expect(sql).toMatch(/CREATE POLICY\s+"Customers manage own ratings"/i);
    expect(sql).toMatch(/WITH CHECK\s*\(/i);
    // driver_id must match the order's assigned driver
    expect(sql).toMatch(/o\.driver_id\s*=\s*ratings\.driver_id/i);
    // the order must be delivered or payment_released
    expect(sql).toMatch(
      /status\s+IN\s*\(\s*'delivered'\s*,\s*'payment_released'\s*\)/i
    );
    // the policy no longer permits an arbitrary attacker-chosen driver_id
    expect(sql).not.toMatch(
      /WITH CHECK\s*\(\s*customer_id\s*=\s*get_profile_id\s*\(\s*\)\s*\)\s*;/i
    );
  });
});
