const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const migrations = path.join(__dirname, '..', 'migrations');
const correction = '20260930191549_remove_driver_accuracy_address.sql';
const driver = '10000000-0000-0000-0000-000000000001';
const details = '20000000-0000-0000-0000-000000000001';

async function fixture(t, accuracy = 12.5) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE TABLE profiles (id uuid PRIMARY KEY, full_name text, phone text);
    CREATE TABLE trucks (id uuid PRIMARY KEY, driver_id uuid, truck_type text, number_plate text);
    CREATE TABLE driver_details (id uuid PRIMARY KEY, user_id uuid, truck_id uuid,
      is_online boolean, rating numeric, total_trips integer, updated_at timestamptz);
    CREATE TABLE driver_locations (id serial PRIMARY KEY, driver_id uuid,
      latitude numeric(10,8), longitude numeric(11,8), accuracy numeric, is_active boolean);
    INSERT INTO profiles VALUES ('${driver}', 'Driver', '123');
    INSERT INTO driver_details VALUES ('${details}', '${driver}', NULL, true, 4.5, 12, now());
  `);
  await db.query('INSERT INTO driver_locations (driver_id, latitude, longitude, accuracy, is_active) VALUES ($1, 18.5204, 73.8567, $2, true)', [driver, accuracy]);
  // Exercise the latest view definition and its existing update function.
  await db.exec(fs.readFileSync(path.join(migrations, '20260811090000_add_driver_busy_status.sql'), 'utf8'));
  await db.exec('CREATE TRIGGER drivers_update_trigger INSTEAD OF UPDATE ON drivers FOR EACH ROW EXECUTE FUNCTION sync_drivers_update()');
  await db.exec(fs.readFileSync(path.join(migrations, correction), 'utf8'));
  return db;
}

async function row(db) {
  return (await db.query('SELECT * FROM drivers')).rows[0];
}

for (const accuracy of [12.5, null, 0]) {
  test(`GPS accuracy ${accuracy} is never exposed as an address`, async t => {
    const db = await fixture(t, accuracy);
    assert.deepEqual((await row(db)).current_location, { lat: 18.5204, lng: 73.8567 });
    assert.equal((await db.query('SELECT accuracy FROM driver_locations')).rows[0].accuracy,
      accuracy === null ? null : String(accuracy));
  });
}

test('absent active location has null coordinates without a fake address', async t => {
  const db = await fixture(t);
  await db.exec('UPDATE driver_locations SET is_active = false');
  assert.deepEqual((await row(db)).current_location, { lat: null, lng: null });
});

test('existing location update trigger still replaces the active coordinates', async t => {
  const db = await fixture(t);
  await db.query('UPDATE drivers SET current_location = $1::jsonb WHERE id = $2',
    [JSON.stringify({ lat: 19.076, lng: 72.8777 }), details]);
  assert.deepEqual((await row(db)).current_location, { lat: 19.076, lng: 72.8777 });
  assert.equal((await db.query('SELECT count(*)::int AS n FROM driver_locations WHERE is_active')).rows[0].n, 1);
});

test('BUSY status, availability and existing driver columns remain intact', async t => {
  const db = await fixture(t);
  await db.exec("UPDATE drivers SET status = 'BUSY'");
  const result = await row(db);
  assert.equal(result.status, 'BUSY');
  assert.equal(result.availability, true);
  assert.equal(result.is_busy, true);
  assert.equal(result.name, 'Driver');
  assert.equal(result.rating, '4.5');
  assert.equal(result.trips_completed, 12);
  await db.exec('UPDATE drivers SET availability = false');
  assert.equal((await row(db)).status, 'OFFLINE');
});

test('forward migration can be reapplied without losing view updates', async t => {
  const db = await fixture(t);
  await db.exec(fs.readFileSync(path.join(migrations, correction), 'utf8'));
  await db.exec('UPDATE drivers SET is_busy = true');
  assert.equal((await row(db)).status, 'BUSY');
  assert.equal(Object.hasOwn((await row(db)).current_location, 'address'), false);
});
