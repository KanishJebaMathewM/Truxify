import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '../../../supabase/migrations');

// Any of these markers counts as caller verification / access restriction on a
// SECURITY DEFINER function. A function with none of them is a privilege-
// escalation vector (see issue #5890).
const HARDENING_MARKERS = [
  'auth.role()',
  'auth.uid()',
  'get_profile_id()',
  'REVOKE EXECUTE',
  'service_role',
];

/**
 * Scans every migration (applied in filename order, oldest → newest) and
 * returns the LATEST definition of each SECURITY DEFINER function, keyed by
 * function name, with its full SQL block (from its CREATE statement to the
 * next CREATE statement or end of file).
 */
function latestSecurityDefinerFunctions() {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const defs = {};

  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const re = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(?:public\.)?(\w+)/g;
    let match;
    while ((match = re.exec(sql)) !== null) {
      const start = match.index;
      const nextCreate = sql.indexOf('CREATE', start + 1);
      const block = sql.slice(start, nextCreate === -1 ? sql.length : nextCreate);
      const headerEnd = block.indexOf('AS $');
      const header = headerEnd === -1 ? block : block.slice(0, headerEnd);
      if (!header.includes('SECURITY DEFINER')) continue;
      defs[match[1]] = { file, block };
    }
  }

  return defs;
}

describe('SECURITY DEFINER release gate (issue #5890)', () => {
  const defs = latestSecurityDefinerFunctions();

  it('finds SECURITY DEFINER functions in the migrations', () => {
    expect(Object.keys(defs).length).toBeGreaterThanOrEqual(10);
  });

  it('every SECURITY DEFINER function has caller verification or is revoke-restricted', () => {
    const unhardened = Object.entries(defs)
      .filter(([, { block }]) => !HARDENING_MARKERS.some((mk) => block.includes(mk)))
      .map(([name, { file }]) => `${name} (${file})`);
    expect(unhardened).toEqual([]);
  });

  it('update_order_and_load_offer verifies the caller owns the order', () => {
    const def = defs['update_order_and_load_offer'];
    expect(def).toBeDefined();
    expect(def.block).toContain('SET search_path = public, pg_temp');
    expect(def.block).toMatch(/get_profile_id\(\).*v_customer_id|v_customer_id.*get_profile_id\(\)/);
    expect(def.block).toContain('REVOKE EXECUTE');
  });

  it('create_order_tx binds non-service callers to their own profile', () => {
    const def = defs['create_order_tx'];
    expect(def).toBeDefined();
    expect(def.block).toContain('SET search_path = public, pg_temp');
    expect(def.block).toContain("auth.role() = 'service_role'");
    expect(def.block).toContain('v_customer_id := get_profile_id()');
    expect(def.block).toContain('cannot create orders as another customer');
  });
});
