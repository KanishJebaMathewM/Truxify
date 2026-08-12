#!/usr/bin/env node
/**
 * Development Profile Seed Script
 *
 * Creates (or updates) two predictable test profiles in Supabase for use
 * with BYPASS_AUTH=true local development and integration testing.
 *
 * Usage:
 *   npm run seed:dev
 *
 * Required environment variables:
 *   SUPABASE_URL              — e.g. http://localhost:54321
 *   SUPABASE_SERVICE_ROLE_KEY — service role key (bypasses RLS)
 *
 * The script is idempotent: running it multiple times will upsert the
 * profiles without creating duplicates.
 */

import { createClient } from '@supabase/supabase-js';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(apiRoot, '..', '..');

// Load environment variables from both local api folder and root directory
dotenv.config({ path: path.join(apiRoot, '.env') });
dotenv.config({ path: path.join(repoRoot, '.env') });

// ── Colour helpers ────────────────────────────────────────────────────
const c = {
  green:  (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red:    (s) => `\x1b[31m${s}\x1b[0m`,
  bold:   (s) => `\x1b[1m${s}\x1b[0m`,
  dim:    (s) => `\x1b[2m${s}\x1b[0m`,
  cyan:   (s) => `\x1b[36m${s}\x1b[0m`,
};
const TICK  = c.green('✔');
const CROSS = c.red('✖');

// ── Dev profile definitions ───────────────────────────────────────────
const DEV_PROFILES = [
  {
    id:           '11111111-1111-1111-1111-111111111111',
    firebase_uid: 'dev_firebase_uid_customer',
    role:         'customer',
    full_name:    'Dev Customer',
    phone:        '+919000000001',
    email:        'dev-customer@truxify.local',
    is_active:    true,
    language:     'en',
    dark_mode:    false,
  },
  {
    id:           '22222222-2222-2222-2222-222222222222',
    firebase_uid: 'dev_firebase_uid_driver',
    role:         'driver',
    full_name:    'Dev Driver',
    phone:        '+919000000002',
    email:        'dev-driver@truxify.local',
    is_active:    true,
    language:     'hi',
    dark_mode:    true,
  },
  {
    id:           '33333333-3333-3333-3333-333333333333',
    firebase_uid: 'dev_firebase_uid_admin',
    role:         'admin',
    full_name:    'Dev Admin',
    phone:        '+919000000003',
    email:        'dev-admin@truxify.local',
    is_active:    true,
    language:     'en',
    dark_mode:    true,
  },
];

function filterProfiles(roleFilter) {
  if (!roleFilter) return DEV_PROFILES;
  return DEV_PROFILES.filter(p => p.role === roleFilter);
}

// ── Environment validation ────────────────────────────────────────────
function validateEnv() {
  const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
  const missing = required.filter((k) => !process.env[k]);

  if (missing.length > 0) {
    console.error();
    console.error(c.red('  Missing required environment variables:'));
    for (const key of missing) {
      console.error(`    ${CROSS} ${c.bold(key)}`);
    }
    console.error();
    console.error(c.dim('  Copy .env.example to .env and fill in your Supabase credentials.'));
    console.error();
    process.exit(1);
  }
}

// ── Main ──────────────────────────────────────────────────────────────
async function main() {
  console.log();
  console.log(c.bold('  Truxify — Development Profile Seed'));
  console.log(c.dim('  ────────────────────────────────────'));
  console.log();

  validateEnv();

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  // Verify connectivity with a lightweight query
  const { error: pingError } = await supabase
    .from('profiles')
    .select('id')
    .limit(1);

  if (pingError) {
    console.error(`  ${CROSS} ${c.red('Unable to connect to Supabase:')}`);
    console.error(`      ${c.dim(pingError.message)}`);
    console.error();
    process.exit(1);
  }

  console.log(`  ${TICK} ${c.green('Connected to Supabase')}`);
  console.log();

  // Upsert all dev profiles
  const { error } = await supabase
    .from('profiles')
    .upsert(DEV_PROFILES, { onConflict: 'id' });

  if (error) {
    console.error(`  ${CROSS} ${c.red('Failed to seed profiles:')}`);
    console.error(`      ${c.dim(error.message)}`);
    console.error();
    process.exit(1);
  }

  // Success output
  console.log(`  ${TICK} ${c.green('Development profiles ready')}`);
  console.log();

  for (const profile of DEV_PROFILES) {
    const roleLabel = profile.role === 'customer'
      ? c.cyan('Customer')
      : c.yellow('Driver ');
    console.log(`  ${roleLabel}  ${c.bold(profile.id)}`);
    console.log(`           role: ${profile.role}  name: ${profile.full_name}`);
    console.log();
  }

  console.log(c.dim('  ── How to use ──────────────────────────────────────────────────'));
  console.log(c.dim('  Set BYPASS_AUTH=true in your .env, then pass the profile ID in'));
  console.log(c.dim('  the x-user-id header with the appropriate x-user-role:'));
  console.log();
  console.log(c.dim('  Customer request:'));
  console.log(c.dim('    curl -H "x-user-id: 11111111-1111-1111-1111-111111111111" \\'));
  console.log(c.dim('         -H "x-user-role: customer" \\'));
  console.log(c.dim('         http://localhost:3000/api/orders'));
  console.log();
  console.log(c.dim('  Driver request:'));
  console.log(c.dim('    curl -H "x-user-id: 22222222-2222-2222-2222-222222222222" \\'));
  console.log(c.dim('         -H "x-user-role: driver" \\'));
  console.log(c.dim('         http://localhost:3000/api/trips'));
  console.log();
}

main().catch((err) => {
  console.error(c.red('\n  Unexpected error:'), err.message);
  process.exit(1);
});
