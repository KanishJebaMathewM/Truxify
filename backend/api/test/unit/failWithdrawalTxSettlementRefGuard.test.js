import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(process.cwd(), '..', '..', 'supabase', 'migrations');

const migrationFiles = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

/**
 * The effective definition is the one in the highest-sorting migration that
 * creates or replaces the function, since migrations apply in order.
 */
const definitions = migrationFiles
  .filter((f) =>
    /CREATE OR REPLACE FUNCTION\s+(public\.)?fail_withdrawal_tx/i.test(
      readFileSync(join(MIGRATIONS_DIR, f), 'utf8'),
    ),
  )
  .map((f) => ({ file: f, sql: readFileSync(join(MIGRATIONS_DIR, f), 'utf8') }));

const effective = definitions[definitions.length - 1];

function functionBody(sql) {
  const start = sql.search(/CREATE OR REPLACE FUNCTION\s+(public\.)?fail_withdrawal_tx/i);
  expect(start, 'fail_withdrawal_tx definition not found').toBeGreaterThan(-1);
  const asDollar = sql.indexOf('AS $$', start);
  const end = sql.indexOf('$$;', asDollar);
  return sql.slice(start, end);
}

describe('fail_withdrawal_tx settlement_ref guard', () => {
  it('has a definition to test', () => {
    expect(definitions.length).toBeGreaterThan(0);
    expect(effective).toBeDefined();
  });

  it('refuses to refund a withdrawal that has a recorded settlement_ref', () => {
    const body = functionBody(effective.sql);
    // Both the locking SELECT and the UPDATE must assert the guard.
    const guardOccurrences = body.match(/settlement_ref IS NULL/g) || [];
    expect(guardOccurrences.length).toBeGreaterThanOrEqual(2);
  });

  it('does not release reserved funds for a row it refused to claim', () => {
    const body = functionBody(effective.sql);
    // The driver_details refund must sit behind the v_driver_id IS NULL bail-out,
    // otherwise a refused refund still moves money.
    const bailIndex = body.indexOf('IF v_driver_id IS NULL THEN');
    const refundIndex = body.indexOf('UPDATE driver_details');
    expect(bailIndex).toBeGreaterThan(-1);
    expect(refundIndex).toBeGreaterThan(-1);
    expect(bailIndex).toBeLessThan(refundIndex);
  });

  it('keeps the service_role restriction', () => {
    const body = functionBody(effective.sql);
    expect(body).toMatch(/auth\.role\(\)\s*<>\s*'service_role'/);
  });

  it('keeps withdrawal status and type scoping on both statements', () => {
    const body = functionBody(effective.sql);
    const typeChecks = body.match(/txn_type = 'withdrawal'/g) || [];
    const statusChecks = body.match(/status = 'pending'/g) || [];
    expect(typeChecks.length).toBeGreaterThanOrEqual(2);
    expect(statusChecks.length).toBeGreaterThanOrEqual(2);
  });
});