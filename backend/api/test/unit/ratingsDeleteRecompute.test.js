import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Regression for #14938: submit_rating_tx recomputes driver_details.rating on
// INSERT/UPDATE only, but the "Customers manage own ratings" RLS policy is
// FOR ALL (permits DELETE via its USING clause) and there was no AFTER DELETE
// trigger. So deleting a rating left the stored driver average permanently
// stale. This test asserts the AFTER DELETE recompute migration is present and
// wired to refresh driver_details.rating from AVG(stars) over the surviving
// rows — mirroring the repo's established migration-regression pattern
// (ratingsRlsRegression.test.js).
describe('ratings AFTER DELETE recomputes driver average (#14938)', () => {
  const sql = readFileSync(
    path.resolve(
      __dirname,
      '../../../../supabase/migrations/20260815000000_ratings_after_delete_recompute.sql'
    ),
    'utf8'
  );

  it('defines a trigger function that recomputes AVG(stars) for the deleted row driver', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION\s+recompute_driver_rating_after_rating_delete\(\)/i);
    // recompute from the surviving ratings for OLD.driver_id (NOT the deleted row)
    expect(sql).toMatch(/FROM\s+ratings\s+WHERE\s+driver_id\s*=\s*OLD\.driver_id/i);
    expect(sql).toMatch(/ROUND\s*\(\s*AVG\s*\(\s*stars\s*\)/i);
    // write the recomputed average back to driver_details for that driver
    expect(sql).toMatch(/UPDATE\s+driver_details\s+SET\s+rating\s*=\s*v_new_avg/i);
    expect(sql).toMatch(/user_id\s*=\s*OLD\.driver_id/i);
  });

  it('wires the function to an AFTER DELETE FOR EACH ROW trigger on ratings', () => {
    expect(sql).toMatch(/DROP TRIGGER IF EXISTS\s+trg_ratings_after_delete_recompute\s+ON\s+public\.ratings/i);
    expect(sql).toMatch(/CREATE TRIGGER\s+trg_ratings_after_delete_recompute\s+AFTER DELETE\s+ON\s+public\.ratings\s+FOR EACH ROW\s+EXECUTE (?:FUNCTION|PROCEDURE)\s+recompute_driver_rating_after_rating_delete\(\)/i);
  });

  it('is idempotent (drops the trigger before creating it)', () => {
    expect(sql).toMatch(/DROP TRIGGER IF EXISTS\s+trg_ratings_after_delete_recompute/i);
  });
});
