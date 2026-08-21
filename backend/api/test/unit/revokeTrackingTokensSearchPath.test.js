import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Regression test for issue #13962: `revoke_tracking_tokens_on_terminal_status`
// is a SECURITY DEFINER trigger function that runs on order updates and executes
// unqualified `update tracking_tokens ...` statements. It must pin `search_path`
// to `public, pg_temp` to prevent search_path shadowing / privilege escalation.
describe('revoke_tracking_tokens_on_terminal_status pins search_path (issue #13962)', () => {
  const definingMigration = readFileSync(
    path.resolve(
      __dirname,
      '../../../../supabase/migrations/20260716000000_add_public_tracking_tokens.sql'
    ),
    'utf8'
  );

  const hardeningMigration = readFileSync(
    path.resolve(
      __dirname,
      '../../../../supabase/migrations/20260809000004_set_search_path_on_remaining_definer_functions.sql'
    ),
    'utf8'
  );

  it('pins search_path in the defining migration definition', () => {
    expect(definingMigration).toMatch(
      /create\s+or\s+replace\s+function\s+revoke_tracking_tokens_on_terminal_status\s*\(\s*\)[\s\S]*?security\s+definer\s+set\s+search_path\s*=\s*public,\s*pg_temp/i
    );
  });

  it('pins search_path via ALTER FUNCTION in the hardening migration', () => {
    expect(hardeningMigration).toMatch(
      /ALTER\s+FUNCTION\s+public\.revoke_tracking_tokens_on_terminal_status\s*\(\s*\)\s*SET\s+search_path\s*=\s*public,\s*pg_temp/i
    );
  });
});
