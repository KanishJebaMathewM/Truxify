import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Regression test for issue #13099: complete_trip_tx must not be fail-open on
// service_role. The wallet-credit guard must compare the supplied release hash
// to the recorded on-chain settlement (orders.release_tx_hash /
// orders.blockchain_tx_hash) rather than merely testing non-null, so a random
// non-null hash cannot credit the driver wallet.
describe('complete_trip_tx fail-closed on unverified release hash (issue #13099)', () => {
  const sql = readFileSync(
    path.resolve(
      __dirname,
      '../../../../supabase/migrations/20260812130000_complete_trip_tx_fail_closed_on_missing_wallet.sql'
    ),
    'utf8'
  );

  it('rejects a non-null but unverified release hash instead of trusting any non-null value', () => {
    expect(sql).toMatch(
      /p_release_tx_hash\s+is\s+distinct\s+from\s+coalesce\s*\(\s*v_order\.release_tx_hash\s*,\s*v_order\.blockchain_tx_hash\s*\)/i
    );
  });

  it('still requires a release hash when escrow is not disabled and not released', () => {
    expect(sql).toMatch(
      /raise exception\s+'Blockchain escrow release must complete before crediting driver wallet'/i
    );
  });
});
