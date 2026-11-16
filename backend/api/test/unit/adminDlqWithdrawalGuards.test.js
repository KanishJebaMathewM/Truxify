import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MIGRATION = path.resolve(
  __dirname,
  '../../../../supabase/migrations/20260930120000_admin_dlq_withdrawal_state_guards.sql',
);

const sql = fs.readFileSync(MIGRATION, 'utf8');

/** Text of the `p_action = '<action>' ... ` branch (retry is the first IF, refund the ELSIF). */
function actionBranch(action) {
  const start = sql.indexOf(`ELSIF p_action = '${action}' THEN`) !== -1
    ? sql.indexOf(`ELSIF p_action = '${action}' THEN`)
    : sql.indexOf(`IF p_action = '${action}' THEN`);

  expect(start, `expected branch for action "${action}"`).toBeGreaterThan(-1);

  const boundaries = [
    "ELSIF p_action = 'retry' THEN",
    "ELSIF p_action = 'refund' THEN",
    '\n  ELSE',
  ]
    .map((m) => sql.indexOf(m))
    .filter((i) => i > start);

  return sql.slice(start, Math.min(...boundaries));
}

describe('admin_resolve_dlq_withdrawal state guards (regression)', () => {
  it('replaces the existing function rather than adding a second overload', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION admin_resolve_dlq_withdrawal\s*\(/);
  });

  it('keeps the parameter names adminRoutes.js calls with', () => {
    for (const param of ['p_withdrawal_id', 'p_action', 'p_admin_id', 'p_notes']) {
      expect(sql).toContain(param);
    }
    expect(sql).toMatch(/p_withdrawal_id uuid/);
    expect(sql).toMatch(/p_action text/);
  });

  it('keeps the service_role authorization check', () => {
    expect(sql).toMatch(/auth\.role\(\)\s*<>\s*'service_role'/);
  });

  describe('double-refund guard', () => {
    const refund = actionBranch('refund');

    it('still refuses to refund a completed withdrawal', () => {
      expect(refund).toMatch(/v_current_status = 'completed'/);
    });

    it('refuses to refund a withdrawal that a previous refund already failed', () => {
      expect(refund).toMatch(/v_current_status = 'failed'/);
      expect(refund).toMatch(/already been refunded/i);
    });

    it('checks the failed guard BEFORE crediting the driver, not after', () => {
      const guard = refund.indexOf("v_current_status = 'failed'");
      const credit = refund.indexOf('wallet_confirmed = wallet_confirmed +');
      expect(guard).toBeGreaterThan(-1);
      expect(credit).toBeGreaterThan(-1);
      // A guard that runs after the credit would still double-refund.
      expect(guard).toBeLessThan(credit);
    });

    it('marks the withdrawal failed exactly once per call', () => {
      expect(refund.match(/SET status = 'failed'/g) || []).toHaveLength(1);
    });
  });

  describe('refund balance arithmetic', () => {
    const refund = actionBranch('refund');

    it('no longer floors the debit at 0 while crediting the full amount', () => {
      // The old body paired an unbounded credit with a floored debit, which
      // minted money whenever wallet_pending < amount.
      expect(refund).not.toMatch(/GREATEST\(\s*wallet_pending\s*-\s*v_amount\s*,\s*0\s*\)/);
    });

    it('computes a refundable amount capped by the amount actually reserved', () => {
      expect(refund).toMatch(/v_refundable\s*:=\s*GREATEST\(LEAST\(v_amount/);
    });

    it('credits and debits the same capped amount', () => {
      expect(refund).toMatch(/wallet_pending\s*=\s*wallet_pending\s*-\s*v_refundable/);
      expect(refund).toMatch(/wallet_confirmed\s*=\s*wallet_confirmed\s*\+\s*v_refundable/);
    });
  });

  describe('retry guard', () => {
    const retry = actionBranch('retry');

    it('refuses to re-queue a completed withdrawal', () => {
      expect(retry).toMatch(/v_current_status = 'completed'/);
    });

    it('refuses to re-queue an already refunded withdrawal', () => {
      expect(retry).toMatch(/v_current_status = 'failed'/);
    });

    it('validates the status before rewriting the row to pending', () => {
      const guard = retry.indexOf("v_current_status = 'completed'");
      const update = retry.indexOf("SET status = 'pending'");
      expect(guard).toBeGreaterThan(-1);
      expect(update).toBeGreaterThan(-1);
      expect(guard).toBeLessThan(update);
    });

    it('preserves settled_at so the settlement worker keeps skipping settled rows', () => {
      // Clearing settled_at would re-arm the worker's payout path.
      expect(retry).not.toMatch(/settled_at\s*=\s*NULL/);
      expect(retry).not.toMatch(/settled_at\s*=\s*now\(\)/);
    });
  });

  describe('the superseded version no longer has the defects', () => {
    it('old migration still contains the bug, proving the new one supersedes it', () => {
      const old = fs.readFileSync(
        path.resolve(__dirname, '../../../../supabase/migrations/20260912160000_withdrawal_retry_queue_and_dlq.sql'),
        'utf8',
      );
      expect(old).toMatch(/GREATEST\(\s*wallet_pending\s*-\s*v_amount\s*,\s*0\s*\)/);
      expect(old).not.toMatch(/v_current_status = 'failed'/);
    });
  });
});
