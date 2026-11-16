import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('road_grip_reports migration schema and security validation (#9569)', () => {
  let migrationSql;

  beforeAll(async () => {
    const migrationsDir = path.resolve(__dirname, '../../../../supabase/migrations');
    const files = await fs.readdir(migrationsDir);
    const migrationFile = files.find(f => f.includes('create_road_grip_reports_table'));
    expect(migrationFile).toBeDefined();

    migrationSql = await fs.readFile(path.join(migrationsDir, migrationFile), 'utf8');
  });

  it('creates the public.road_grip_reports table with correct schema', () => {
    expect(migrationSql).toMatch(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.road_grip_reports/i);
    expect(migrationSql).toMatch(/id\s+UUID\s+PRIMARY\s+KEY/i);
    expect(migrationSql).toMatch(/latitude\s+DOUBLE\s+PRECISION\s+NOT\s+NULL/i);
    expect(migrationSql).toMatch(/longitude\s+DOUBLE\s+PRECISION\s+NOT\s+NULL/i);
    expect(migrationSql).toMatch(/grip_index\s+NUMERIC\s+NOT\s+NULL/i);
    expect(migrationSql).toMatch(/slip_events_count\s+INT/i);
    expect(migrationSql).toMatch(/user_id\s+UUID\s+REFERENCES\s+public\.profiles\s*\(\s*id\s*\)/i);
    expect(migrationSql).toMatch(/recorded_at\s+TIMESTAMPTZ\s+NOT\s+NULL\s+DEFAULT\s+NOW\(\)/i);
  });

  it('creates indexes for bounding-box and recency queries', () => {
    expect(migrationSql).toMatch(/CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?idx_road_grip_reports_coords_recorded/i);
    expect(migrationSql).toMatch(/ON\s+public\.road_grip_reports\s*\(\s*latitude\s*,\s*longitude\s*,\s*recorded_at\s+DESC\s*\)/i);
    expect(migrationSql).toMatch(/CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?idx_road_grip_reports_recorded_at/i);
    expect(migrationSql).toMatch(/CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?idx_road_grip_reports_user_id/i);
  });

  it('enables Row Level Security and defines appropriate policies', () => {
    expect(migrationSql).toMatch(/ALTER\s+TABLE\s+public\.road_grip_reports\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    expect(migrationSql).toMatch(/CREATE\s+POLICY\s+"Authenticated users can read road grip reports"/i);
    expect(migrationSql).toMatch(/FOR\s+SELECT\s+TO\s+authenticated/i);
    expect(migrationSql).toMatch(/CREATE\s+POLICY\s+"Authenticated users can insert road grip reports"/i);
    expect(migrationSql).toMatch(/FOR\s+INSERT\s+TO\s+authenticated/i);
    expect(migrationSql).toMatch(/CREATE\s+POLICY\s+"Service role full access on road_grip_reports"/i);
    expect(migrationSql).toMatch(/FOR\s+ALL\s+TO\s+service_role/i);
  });

  it('revokes anon access to protect telemetry privacy', () => {
    expect(migrationSql).toMatch(/REVOKE\s+ALL\s+ON\s+TABLE\s+public\.road_grip_reports\s+FROM\s+anon/i);
  });
});
