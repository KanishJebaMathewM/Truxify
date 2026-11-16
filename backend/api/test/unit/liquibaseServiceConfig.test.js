import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const spawn = vi.hoisted(() => vi.fn());
vi.mock('child_process', () => ({ spawn }));

const ENV_KEYS = ['DATABASE_URL', 'DB_USERNAME', 'DB_PASSWORD'];
const MESSAGE = 'DATABASE_URL, DB_USERNAME, and DB_PASSWORD environment variables are required';

describe('LiquibaseService configuration', () => {
  let saved;

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
    spawn.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('loads without database credentials so the API can start', async () => {
    const { default: service } = await import('../../../../database/liquibase/liquibase.service.js');
    expect(service.isConfigured()).toBe(false);
  });

  it('answers every operation with the missing-config error and never spawns liquibase', async () => {
    const { default: service } = await import('../../../../database/liquibase/liquibase.service.js');

    for (const result of [
      await service.runMigrations(),
      await service.rollback(1),
      await service.getStatus(),
      await service.validate(),
    ]) {
      expect(result).toEqual({ success: false, error: MESSAGE });
    }
    expect(spawn).not.toHaveBeenCalled();
  });

  it('is configured when all three variables are set', async () => {
    process.env.DATABASE_URL = 'jdbc:postgresql://localhost:5432/truxify';
    process.env.DB_USERNAME = 'postgres';
    process.env.DB_PASSWORD = 'secret';
    const { default: service } = await import('../../../../database/liquibase/liquibase.service.js');
    expect(service.isConfigured()).toBe(true);
  });
});
