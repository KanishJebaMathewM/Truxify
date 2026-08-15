import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Regression test for issue #13097: `register_device_token` is a SECURITY
// DEFINER function that references unqualified tables, so it must pin
// `search_path` to avoid a search_path hijack / privilege-escalation vector.
// The pin is applied via ALTER in
// 20260809000000_set_search_path_on_remaining_definer_functions.sql.
describe('register_device_token pins search_path (issue #13097)', () => {
  const sql = readFileSync(
    path.resolve(
      __dirname,
      '../../../../supabase/migrations/20260809000000_set_search_path_on_remaining_definer_functions.sql'
    ),
    'utf8'
  );

  it('pins search_path on register_device_token via ALTER FUNCTION', () => {
    expect(sql).toMatch(
      /ALTER FUNCTION\s+public\.register_device_token\s*\(\s*uuid\s*,\s*text\s*,\s*text\s*,\s*jsonb\s*,\s*uuid\s*\)\s*SET search_path\s*=\s*public,\s*pg_temp/i
    );
  });
});
