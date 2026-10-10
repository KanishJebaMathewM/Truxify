import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
const { PGlite } = createRequire(import.meta.url)('@electric-sql/pglite');
const legacySql = readFileSync(new URL('../../../../supabase/migrations/20260804101000_create_lookup_tables.sql', import.meta.url), 'utf8');
const upgradeSql = readFileSync(new URL('../../../../supabase/migrations/20260805000050_create_vehicle_types_regions.sql', import.meta.url), 'utf8');
const databases = [];
async function db({ legacy = false, defaults = false } = {}) {
  const database = new PGlite(); databases.push(database);
  await database.exec(`CREATE ROLE anon; CREATE ROLE authenticated; GRANT USAGE ON SCHEMA public TO anon, authenticated;`);
  // Supabase normally has table default grants; the upgrade must also work
  // without relying on those environment-specific defaults.
  if (defaults) await database.exec('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon, authenticated');
  if (legacy) await database.exec(legacySql);
  return database;
}
afterEach(async () => { while (databases.length) await databases.pop().close(); });

describe('lookup migration upgrade from the earlier minimal schemas', () => {
  it('applies both migrations in order and adds every enriched lookup column', async () => {
    const database = await db({ legacy: true });
    await database.exec(upgradeSql);
    const rows = (await database.query("SELECT table_name, column_name FROM information_schema.columns WHERE table_name IN ('vehicle_types', 'regions')")).rows;
    const columns = table => rows.filter(row => row.table_name === table).map(row => row.column_name);
    expect(columns('vehicle_types')).toEqual(expect.arrayContaining(['capacity_tonnes', 'max_capacity_tons', 'min_capacity_tons', 'length_ft', 'is_active', 'sort_order']));
    expect(columns('regions')).toEqual(expect.arrayContaining(['code', 'state', 'country', 'latitude', 'longitude', 'radius_km', 'is_active']));
    expect((await database.query('SELECT name FROM vehicle_types ORDER BY sort_order')).rows.map(row => row.name))
      .toEqual(['Open Body', 'Closed Body', 'Container', 'Refrigerated']);
  });
  it('preserves existing lookup identities and data while seeding only missing vehicle types', async () => {
    const database = await db({ legacy: true });
    await database.exec("INSERT INTO vehicle_types(id,name,capacity_tonnes) VALUES ('10000000-0000-0000-0000-000000000001','Open Body',18); INSERT INTO regions(name,code) VALUES ('Delhi','DL');");
    await database.exec(upgradeSql);
    const vehicle = (await database.query("SELECT id,capacity_tonnes,is_active FROM vehicle_types WHERE name='Open Body'")).rows[0];
    expect(vehicle).toEqual({ id: '10000000-0000-0000-0000-000000000001', capacity_tonnes: '18', is_active: true });
    expect((await database.query("SELECT code,country,radius_km,is_active FROM regions WHERE name='Delhi'")).rows[0])
      .toEqual({ code: 'DL', country: 'IN', radius_km: 50, is_active: true });
    expect((await database.query("SELECT count(*)::integer AS n FROM vehicle_types WHERE name='Open Body'")).rows[0].n).toBe(1);
  });
  it('also supports an empty database without the legacy migration', async () => {
    const database = await db();
    await database.exec(upgradeSql);
    expect((await database.query('SELECT count(*)::integer AS n FROM vehicle_types')).rows[0].n).toBe(4);
  });
  it('can be retried without duplicate policies, seeds or loss of data', async () => {
    const database = await db({ legacy: true });
    await database.exec(upgradeSql);
    await database.exec("UPDATE vehicle_types SET is_active=false WHERE name='Container'");
    await database.exec(upgradeSql);
    expect((await database.query('SELECT count(*)::integer AS n FROM vehicle_types')).rows[0].n).toBe(4);
    expect((await database.query("SELECT is_active FROM vehicle_types WHERE name='Container'")).rows[0].is_active).toBe(false);
  });
  it.each(['anon', 'authenticated'])('%s can read only active reference rows, without default grants', async role => {
    const database = await db({ legacy: true });
    await database.exec(upgradeSql);
    await database.exec("UPDATE vehicle_types SET is_active=false WHERE name='Container'; INSERT INTO regions(name,is_active) VALUES ('Visible',true),('Hidden',false)");
    await database.exec(`SET ROLE ${role}`);
    expect((await database.query('SELECT name FROM vehicle_types')).rows.map(row => row.name)).not.toContain('Container');
    expect((await database.query('SELECT name FROM regions')).rows).toEqual([{ name: 'Visible' }]);
    await expect(database.exec("INSERT INTO regions(name) VALUES ('Injected')")).rejects.toThrow(/permission denied|row-level security/i);
  });
});
