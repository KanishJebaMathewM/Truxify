const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const authA = '00000000-0000-0000-0000-000000000001';
const profileA = '10000000-0000-0000-0000-000000000001';
const profileB = '10000000-0000-0000-0000-000000000002';
const oldAddress = '20000000-0000-0000-0000-000000000001';
const newAddress = '20000000-0000-0000-0000-000000000002';
const otherAddress = '20000000-0000-0000-0000-000000000003';
const migrations = path.join(__dirname, '..', 'migrations');

async function fixture(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE authenticated;
    CREATE ROLE anon;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
      SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
    $$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT (auth.jwt()->>'sub')::uuid;
    $$;
    CREATE TABLE profiles (id uuid PRIMARY KEY, firebase_uid text UNIQUE);
    CREATE FUNCTION get_profile_id() RETURNS uuid LANGUAGE sql STABLE
      SECURITY DEFINER SET search_path = public, pg_temp AS $$
      SELECT id FROM profiles WHERE firebase_uid = (auth.jwt()->>'sub') LIMIT 1;
    $$;
    CREATE TABLE saved_addresses (id uuid PRIMARY KEY, user_id uuid, is_default boolean);
    INSERT INTO profiles VALUES ('${profileA}', '${authA}'),
      ('${profileB}', '00000000-0000-0000-0000-000000000002');
    INSERT INTO saved_addresses VALUES
      ('${oldAddress}', '${profileA}', true),
      ('${newAddress}', '${profileA}', false),
      ('${otherAddress}', '${profileB}', true);
    GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
    GRANT SELECT, UPDATE ON saved_addresses TO authenticated;
    ALTER TABLE saved_addresses ENABLE ROW LEVEL SECURITY;
    CREATE POLICY own_addresses ON saved_addresses TO authenticated
      USING (user_id = get_profile_id()) WITH CHECK (user_id = get_profile_id());
  `);
  await db.exec(fs.readFileSync(path.join(migrations, '20260804000000_add_set_default_address_rpc.sql'), 'utf8'));
  await db.exec(fs.readFileSync(path.join(migrations, '20260930190131_fix_default_address_profile_ownership.sql'), 'utf8'));
  return db;
}

async function caller(db, subject = authA, role = 'authenticated') {
  await db.query("SELECT set_config('request.jwt.claims', $1, false)", [JSON.stringify(subject ? { sub: subject } : {})]);
  await db.exec(`SET ROLE ${role}`);
}

async function setDefault(db, owner, address = newAddress) {
  await db.query('SELECT public.set_default_address($1::uuid, $2::uuid)', [address, owner]);
}

async function defaults(db) {
  await db.exec('RESET ROLE');
  return (await db.query('SELECT id FROM saved_addresses WHERE is_default ORDER BY id')).rows.map(r => r.id);
}

for (const [name, owner] of [['app auth ID', authA], ['profile ID', profileA]]) {
  test(`sets own default using ${name} while preserving another owner`, async t => {
    const db = await fixture(t);
    await caller(db);
    await setDefault(db, owner);
    assert.deepEqual(await defaults(db), [newAddress, otherAddress]);
  });
}

test('rejects another user parameter without changing defaults', async t => {
  const db = await fixture(t);
  await caller(db);
  await assert.rejects(setDefault(db, profileB, otherAddress), /Unauthorized/);
  assert.deepEqual(await defaults(db), [oldAddress, otherAddress]);
});

test('rejects another owner address without clearing the caller default', async t => {
  const db = await fixture(t);
  await caller(db);
  await assert.rejects(setDefault(db, authA, otherAddress), /Address not found/);
  assert.deepEqual(await defaults(db), [oldAddress, otherAddress]);
});

for (const [name, subject, owner] of [
  ['missing JWT subject', null, profileA],
  ['missing mapped profile', '00000000-0000-0000-0000-000000000099', profileA],
  ['null user parameter', authA, null],
]) {
  test(`rejects ${name} without changing defaults`, async t => {
    const db = await fixture(t);
    await caller(db, subject);
    await assert.rejects(setDefault(db, owner), /Unauthorized/);
    assert.deepEqual(await defaults(db), [oldAddress, otherAddress]);
  });
}

test('anon cannot execute the privileged RPC', async t => {
  const db = await fixture(t);
  await caller(db, null, 'anon');
  await assert.rejects(setDefault(db, profileA), /permission denied/);
});
