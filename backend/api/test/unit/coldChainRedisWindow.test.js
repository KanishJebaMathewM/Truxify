import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Redis from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ redis: null, warn: vi.fn() }));
vi.mock('../../src/config/db.js', () => ({
  get redisClient() { return state.redis; }, supabaseAdmin: null,
}));
vi.mock('../../src/middleware/logger.js', () => ({
  default: { warn: state.warn, error: vi.fn(), info: vi.fn() },
}));
vi.mock('../../src/services/notificationService.js', () => ({ sendPushNotification: vi.fn() }));
import { coldChainAnomalyService as service, calculateMeanKineticTemperature as mkt } from '../../src/services/coldChainAnomalyService.js';

let directory;
let server;
let clients = [];
const key = (load = 'fixture') => `coldchain:window:${load}`;
const entry = (t) => JSON.stringify({ t, timestamp: 123 });
const ingest = (temperature, extra = {}) => service.processTelemetry({
  loadId: 'fixture', temperature, targetMin: null, targetMax: null, ...extra,
});
const stored = async () => (await clients[0].lrange(key(), 0, -1)).map((e) => JSON.parse(e).t);

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'truxify-coldchain-'));
  const socket = join(directory, 'redis.sock');
  server = spawn(process.env.REDIS_SERVER_BIN || 'redis-server', [
    '--port', '0', '--unixsocket', socket, '--unixsocketperm', '700',
    '--save', '', '--appendonly', 'no', '--dir', directory,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Local Redis startup timed out: ${output}`)), 10000);
    const fail = (error) => { clearTimeout(timer); reject(error); };
    server.once('error', fail);
    server.once('exit', (code) => fail(new Error(`Local Redis exited ${code}: ${output}`)));
    server.stderr.on('data', (data) => { output += data; });
    server.stdout.on('data', (data) => {
      output += data;
      if (output.toLowerCase().includes('ready to accept connections')) { clearTimeout(timer); resolve(); }
    });
  });
  clients = Array.from({ length: 4 }, () => new Redis(socket));
  await Promise.all(clients.map((client) => client.ping()));
});
afterAll(async () => {
  await Promise.all(clients.map((client) => client.quit()));
  if (server?.pid && server.exitCode === null) {
    const exited = new Promise((resolve) => server.once('exit', resolve));
    server.kill();
    await exited;
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});
beforeEach(async () => {
  await clients[0].flushdb();
  state.redis = clients[0];
  state.warn.mockClear();
  vi.spyOn(service, 'handleSlaBreach').mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('actual cold-chain service with isolated native Redis', () => {
  it('uses one Redis operation for a 1000-reading batch and submits only its retained suffix', async () => {
    const evaluate = vi.spyOn(clients[0], 'eval');
    const pipeline = vi.spyOn(clients[0], 'pipeline');
    const values = Array.from({ length: 1000 }, (_, i) => i / 10);
    const result = await ingest(values);
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(pipeline).not.toHaveBeenCalled();
    const args = evaluate.mock.calls[0];
    expect(args.slice(1, 5)).toEqual([1, key(), 120, 86400]);
    expect(args.slice(5).map((e) => JSON.parse(e).t)).toEqual(values.slice(-120));
    expect(await stored()).toEqual(values.slice(-120));
    expect(result.windowSize).toBe(120);
    expect(result.mkt).toBe(mkt(values.slice(-120)));
    expect(result.latestTemp).toBe(99.9);
  });
  it('preserves the exact suffix when appending to an existing history', async () => {
    await clients[0].rpush(key(), ...Array.from({ length: 119 }, (_, i) => entry(i)));
    await ingest([119, 120, 121]);
    expect(await stored()).toEqual(Array.from({ length: 120 }, (_, i) => i + 2));
  });
  it('returns serializable batch snapshots across four concurrent native clients', async () => {
    let next = 0;
    state.redis = {
      eval: (...args) => clients[next++ % clients.length].eval(...args),
      pipeline: () => clients[next++ % clients.length].pipeline(),
    };
    const batches = Array.from({ length: 16 }, (_, i) => [i * 3, i * 3 + 1, i * 3 + 2]);
    const results = await Promise.all(batches.map((batch) => ingest(batch)));
    const ordered = results.map((result, i) => ({ result, batch: batches[i] }))
      .sort((a, b) => a.result.windowSize - b.result.windowSize);
    let history = [];
    for (const { result, batch } of ordered) {
      history = history.concat(batch);
      expect(result.windowSize).toBe(history.length);
      expect(result.mkt).toBe(mkt(history));
      expect(result.latestTemp).toBe(batch.at(-1));
    }
    expect(await stored()).toEqual(history);
  });
  it('keeps concurrent oversized batches intact with a maximum 120-entry snapshot', async () => {
    let next = 0;
    state.redis = {
      eval: (...args) => clients[next++ % clients.length].eval(...args),
      pipeline: () => clients[next++ % clients.length].pipeline(),
    };
    const results = await Promise.all([1, 2, 3, 4].map((value) => ingest(Array(1000).fill(value))));
    results.forEach((result, i) => {
      expect(result.windowSize).toBe(120);
      expect(result.mkt).toBe(i + 1);
    });
    const values = await stored();
    expect(values).toHaveLength(120);
    expect(new Set(values).size).toBe(1);
  });
  it('preserves the JSON format and refreshes the existing 24-hour TTL', async () => {
    await clients[0].rpush(key(), entry(4));
    await clients[0].expire(key(), 1);
    await ingest(5);
    const raw = JSON.parse((await clients[0].lrange(key(), -1, -1))[0]);
    expect(raw.t).toBe(5);
    expect(Number.isFinite(raw.timestamp)).toBe(true);
    expect(await clients[0].ttl(key())).toBeGreaterThanOrEqual(86399);
    expect(await clients[0].ttl(key())).toBeLessThanOrEqual(86400);
  });
  it('falls back to all valid readings on actual WRONGTYPE without refreshing the bad key', async () => {
    await clients[0].set(key(), 'wrong-type');
    const result = await ingest(Array(1000).fill(5));
    expect(result.windowSize).toBe(1000);
    expect(result.mkt).toBe(5);
    expect(state.warn).toHaveBeenCalledTimes(1);
    expect(await clients[0].get(key())).toBe('wrong-type');
    expect(await clients[0].ttl(key())).toBe(-1);
  });
  it('excludes malformed or nonnumeric retained JSON entries from MKT', async () => {
    await clients[0].rpush(key(), 'broken', 'null', '{}', entry('4'), entry(4));
    const result = await ingest(6);
    expect(result.windowSize).toBe(2);
    expect(result.mkt).toBe(mkt([4, 6]));
  });
  it('isolates windows for different load IDs', async () => {
    await ingest([4, 5], { loadId: 'first' });
    const result = await ingest(8, { loadId: 'second' });
    expect(result.windowSize).toBe(1);
    expect(result.mkt).toBe(8);
    expect(await clients[0].llen(key('first'))).toBe(2);
    expect(await clients[0].llen(key('second'))).toBe(1);
  });
  it('uses one static script for different inputs and keys', async () => {
    const evaluate = vi.spyOn(clients[0], 'eval');
    await ingest([4, 5]);
    await ingest(6, { loadId: 'second' });
    expect(evaluate.mock.calls[0][0]).toBe(evaluate.mock.calls[1][0]);
  });
  it('preserves existing numeric coercion and rejects nonfinite readings', async () => {
    const result = await ingest(['4', undefined, 'invalid', Infinity, null, 6]);
    expect(await stored()).toEqual([4, 0, 6]);
    expect(result.windowSize).toBe(3);
  });
  it('rejects a wholly invalid batch without a Redis operation', async () => {
    const evaluate = vi.spyOn(clients[0], 'eval');
    expect(await ingest([undefined, 'invalid', Infinity])).toEqual({
      success: false, error: 'No valid numeric temperature readings provided',
    });
    expect(evaluate).not.toHaveBeenCalled();
    expect(await clients[0].exists(key())).toBe(0);
  });
  it('retains full local evaluation when Redis is unavailable', async () => {
    state.redis = null;
    const result = await ingest(Array(1000).fill(5));
    expect(result.windowSize).toBe(1000);
    expect(result.mkt).toBe(5);
  });
  it('uses local evaluation and one warning when Redis rejects its command', async () => {
    const failure = new Error('connection unavailable');
    state.redis = { eval: vi.fn().mockRejectedValue(failure) };
    const result = await ingest([4, 6]);
    expect(result.windowSize).toBe(2);
    expect(result.mkt).toBe(mkt([4, 6]));
    expect(state.warn).toHaveBeenCalledWith({ err: failure }, expect.any(String));
  });
  it('still triggers high excursions only at the existing five-sample threshold', async () => {
    expect((await ingest(Array(4).fill(11), { targetMax: 10 })).isBreach).toBe(false);
    const result = await ingest(11, { targetMax: 10 });
    expect(result.isBreach).toBe(true);
    expect(result.breachReason).toContain('5 consecutive readings');
    expect(service.handleSlaBreach).toHaveBeenCalledTimes(1);
  });
  it('still triggers low excursions only at the existing five-sample threshold', async () => {
    expect((await ingest(Array(4).fill(-1), { targetMin: 0 })).isBreach).toBe(false);
    expect((await ingest(-1, { targetMin: 0 })).isBreach).toBe(true);
    expect(service.handleSlaBreach).toHaveBeenCalledTimes(1);
  });
  it('resets consecutive excursions after an in-range reading', async () => {
    const result = await ingest([11, 11, 11, 11, 5, 11], { targetMax: 10 });
    expect(result.isBreach).toBe(false);
    expect(service.handleSlaBreach).not.toHaveBeenCalled();
  });
  it('preserves cumulative MKT degradation detection', async () => {
    const result = await ingest(30, { targetMax: 10 });
    expect(result.mkt).toBe(30);
    expect(result.isBreach).toBe(true);
    expect(result.breachReason).toContain('Cumulative Mean Kinetic Temperature');
  });
});
