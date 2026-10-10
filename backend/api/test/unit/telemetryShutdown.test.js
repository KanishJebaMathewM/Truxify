import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
vi.mock('../../src/config/db.js', () => ({ mongoDb: null }));
vi.mock('../../src/middleware/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

let directory, recovery, pipeline;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const record = (id) => ({ order_id: id, lat: 1, lng: 2 });
const contents = () => fs.readFileSync(recovery, 'utf8').trim().split('\n').map(JSON.parse);
const database = (insertMany) => ({ collection: vi.fn(() => ({ insertMany })) });
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const expire = async (ms = 60) => { await tick(); await vi.advanceTimersByTimeAsync(ms); };
const newInstance = async () => { vi.resetModules(); return (await import('../../src/sockets/telemetryBuffer.js')).default; };

beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'truxify-telemetry-shutdown-'));
  recovery = path.join(directory, 'recovery.jsonl');
  vi.stubEnv('RECOVERY_FILE_PATH', recovery);
  vi.stubEnv('MONGODB_SHUTDOWN_WAIT_MS', '0');
  vi.stubEnv('TELEMETRY_SHUTDOWN_FLUSH_TIMEOUT_MS', '50');
  vi.stubEnv('TELEMETRY_BATCH_SIZE', '2');
  vi.stubEnv('TELEMETRY_BUFFER_MAX_SIZE', '4');
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
  pipeline = await newInstance();
});
afterEach(() => {
  pipeline._test.reset();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe('shared telemetry drain and recovery ownership', () => {
  it('returns and checkpoints a never-settling owned insert with native timers in a fresh Node process', () => {
    // The normal API test runner must also avoid importing provider startup in
    // this child: copy source unchanged with explicit dependency-only seams.
    const nativeRoot = path.join(directory, 'native');
    for (const sub of ['sockets', 'middleware', 'config']) fs.mkdirSync(path.join(nativeRoot, 'src', sub), { recursive: true });
    fs.writeFileSync(path.join(nativeRoot, 'package.json'), '{"type":"module"}');
    const sourceDirectory = path.dirname(fileURLToPath(new URL('../../src/sockets/telemetryBuffer.js', import.meta.url)));
    for (const entry of fs.readdirSync(sourceDirectory, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.js')) fs.copyFileSync(path.join(sourceDirectory, entry.name), path.join(nativeRoot, 'src/sockets', entry.name));
    }
    fs.writeFileSync(path.join(nativeRoot, 'src/middleware/logger.js'), 'export default {info(){},warn(){},error(){}};');
    fs.writeFileSync(path.join(nativeRoot, 'src/config/db.js'), 'export const mongoDb=null;');
    const sourceUrl = pathToFileURL(path.join(nativeRoot, 'src/sockets/telemetryBuffer.js')).href;
    const script = `
      import fs from 'node:fs';
      const {default:p}=await import(${JSON.stringify(sourceUrl)});
      p._test.setMongoDbOverride({collection:()=>({insertMany:()=>new Promise(()=>{})})});
      p.enqueue({order_id:'owned'});p.flush();p.enqueue({order_id:'queued'});
      const started=performance.now();await p.shutdown();
      console.log(JSON.stringify({elapsed:performance.now()-started,records:fs.readFileSync(process.env.RECOVERY_FILE_PATH,'utf8').trim().split('\\n').map(JSON.parse)}));
    `;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, MONGODB_SHUTDOWN_WAIT_MS: '0', TELEMETRY_SHUTDOWN_FLUSH_TIMEOUT_MS: '25' },
      timeout: 2000, encoding: 'utf8',
    });
    expect(child.error, child.stderr).toBeUndefined();
    expect(child.status, child.stderr).toBe(0);
    const result = JSON.parse(child.stdout.trim());
    expect(result.elapsed).toBeGreaterThanOrEqual(15);
    expect(result.elapsed).toBeLessThan(1500);
    expect(result.records).toEqual([{order_id:'owned'}, {order_id:'queued'}]);
  });

  it('bounds an already-running insert and checkpoints its owned batch plus queued arrivals', async () => {
    const write = deferred(); const insert = vi.fn(() => write.promise);
    pipeline._test.setMongoDbOverride(database(insert));
    pipeline.enqueue(record('owned')); const flushing = pipeline.flush();
    pipeline.enqueue(record('queued'));
    const stop = pipeline.shutdown(); let done = false; stop.then(() => { done = true; });
    await expire();
    expect(done).toBe(true);
    expect(contents()).toEqual([record('owned'), record('queued')]);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(pipeline.getState().isFlushing).toBe(true);
    write.resolve(); await flushing;
  });

  it('bounds a new final insert without a second unbounded await', async () => {
    const write = deferred(); const insert = vi.fn(() => write.promise);
    pipeline._test.setMongoDbOverride(database(insert)); pipeline.enqueue(record('final'));
    let done = false; pipeline.shutdown().then(() => { done = true; });
    await expire(); expect(done).toBe(true); expect(contents()).toEqual([record('final')]);
    write.resolve(); await tick();
  });

  it.each(['success', 'rejection'])('preserves recovery after late driver %s', async (outcome) => {
    const write = deferred(); pipeline._test.setMongoDbOverride(database(() => write.promise));
    pipeline.enqueue(record('late')); pipeline.shutdown(); await expire();
    const saved = fs.readFileSync(recovery, 'utf8');
    if (outcome === 'success') write.resolve(); else write.reject(new Error('network outage'));
    await tick(); expect(fs.readFileSync(recovery, 'utf8')).toBe(saved);
    if (outcome === 'rejection') expect(pipeline.getState().bufferSize).toBe(1);
  });

  it('never deletes a newer checkpoint after late success', async () => {
    const write = deferred(); pipeline._test.setMongoDbOverride(database(() => write.promise));
    pipeline.enqueue(record('old')); pipeline.shutdown(); await expire();
    fs.writeFileSync(recovery, JSON.stringify(record('newer')) + '\n');
    write.resolve(); await tick(); expect(contents()).toEqual([record('newer')]);
  });

  it('returns the same shutdown promise for concurrent and repeated callers', async () => {
    const write = deferred(); const insert = vi.fn(() => write.promise);
    pipeline._test.setMongoDbOverride(database(insert)); pipeline.enqueue(record('one'));
    const first = pipeline.shutdown(); expect(pipeline.shutdown()).toBe(first);
    await expire(); await first; expect(pipeline.shutdown()).toBe(first);
    expect(insert).toHaveBeenCalledTimes(1); write.resolve(); await tick();
  });

  it('accepts arrivals during drain without starting overlapping batch-trigger inserts', async () => {
    const write = deferred(); const insert = vi.fn(() => write.promise);
    pipeline._test.setMongoDbOverride(database(insert)); pipeline.enqueue(record('first'));
    pipeline.shutdown(); await tick();
    pipeline.enqueue(record('second')); pipeline.enqueue(record('third'));
    pipeline.flush(); await expire();
    expect(insert).toHaveBeenCalledTimes(1);
    expect(contents()).toEqual(['first', 'second', 'third'].map(record));
    write.resolve(); await tick();
  });

  it('drains queued arrivals after a healthy existing insert within the same budget', async () => {
    const write = deferred(); const insert = vi.fn().mockImplementationOnce(() => write.promise).mockResolvedValue({});
    pipeline._test.setMongoDbOverride(database(insert)); pipeline.enqueue(record('first')); pipeline.flush();
    const stop = pipeline.shutdown(); pipeline.enqueue(record('second')); await tick();
    write.resolve(); await stop;
    expect(insert).toHaveBeenCalledTimes(2);
    expect(insert.mock.calls.map(([records]) => records)).toEqual([[record('first')], [record('second')]]);
    expect(fs.existsSync(recovery)).toBe(false); expect(vi.getTimerCount()).toBe(0);
  });

  it('uses one budget for existing and subsequent final writes', async () => {
    const first = deferred(), second = deferred();
    const insert = vi.fn().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    pipeline._test.setMongoDbOverride(database(insert)); pipeline.enqueue(record('first')); pipeline.flush();
    let done = false; pipeline.shutdown().then(() => { done = true; }); pipeline.enqueue(record('second'));
    await expire(40); first.resolve(); await tick(); await expire(11);
    expect(done).toBe(true); expect(contents()).toEqual([record('second')]);
    second.resolve(); await tick();
  });

  it('checkpoints immediate transient failures without spinning or silently losing retries', async () => {
    const insert = vi.fn().mockRejectedValue(new Error('unavailable'));
    pipeline._test.setMongoDbOverride(database(insert)); pipeline.enqueue(record('retry'));
    await pipeline.shutdown(); expect(insert).toHaveBeenCalledTimes(1);
    expect(contents()).toEqual([record('retry')]); expect(pipeline.getMetrics().retryCount).toBe(1);
  });

  it('handles synchronous collection errors without retaining a settled flush as active', async () => {
    pipeline._test.setMongoDbOverride({ collection() { throw new Error('collection failed'); } });
    pipeline.enqueue(record('retry')); await pipeline.flush();
    expect(pipeline.getState().isFlushing).toBe(false);
    await pipeline.shutdown(); expect(contents()).toEqual([record('retry')]);
  });

  it('waits only the readiness budget when Mongo is unavailable and retains all queued records', async () => {
    vi.stubEnv('MONGODB_SHUTDOWN_WAIT_MS', '30'); pipeline._test.setMongoDbOverride(null);
    pipeline.enqueue(record('offline')); let done = false; pipeline.shutdown().then(() => { done = true; });
    await expire(29); expect(done).toBe(false); await expire(2); expect(done).toBe(true);
    expect(contents()).toEqual([record('offline')]); expect(pipeline.getState().bufferSize).toBe(1);
  });

  it('flushes when Mongo becomes ready during the readiness budget', async () => {
    vi.stubEnv('MONGODB_SHUTDOWN_WAIT_MS', '30'); pipeline._test.setMongoDbOverride(null);
    pipeline.enqueue(record('ready')); const stop = pipeline.shutdown(); await expire(10);
    const insert = vi.fn().mockResolvedValue({}); pipeline._test.setMongoDbOverride(database(insert));
    await expire(21); await stop; expect(insert).toHaveBeenCalledWith([record('ready')], { ordered: false });
    expect(fs.existsSync(recovery)).toBe(false);
  });

  it('checkpoints immediately with a zero flush budget', async () => {
    vi.stubEnv('TELEMETRY_SHUTDOWN_FLUSH_TIMEOUT_MS', '0'); pipeline = await newInstance();
    const insert = vi.fn().mockResolvedValue({}); pipeline._test.setMongoDbOverride(database(insert));
    pipeline.enqueue(record('zero')); await pipeline.shutdown();
    expect(insert).not.toHaveBeenCalled(); expect(contents()).toEqual([record('zero')]);
  });

  it.each(['-1', 'Infinity', 'NaN', '30001'])('uses a finite default for invalid flush budget %s', async (value) => {
    vi.stubEnv('TELEMETRY_SHUTDOWN_FLUSH_TIMEOUT_MS', value); pipeline = await newInstance();
    expect(pipeline.getMetrics().config.shutdownFlushTimeoutMs).toBe(10000);
  });

  it('suppresses restart and meters enqueue after terminal shutdown', async () => {
    pipeline._test.setMongoDbOverride(null); pipeline.enqueue(record('saved')); await pipeline.shutdown();
    pipeline.start(); expect(pipeline.getState().isSchedulerActive).toBe(false);
    expect(pipeline.enqueue(record('too late'))).toBe(1);
    expect(pipeline.getMetrics().eventsDropped).toBe(1); expect(contents()).toEqual([record('saved')]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops scheduler timers and prevents a pending scheduler continuation from restarting', async () => {
    vi.stubEnv('TELEMETRY_FLUSH_INTERVAL_MS', '10'); pipeline = await newInstance();
    const write = deferred(); pipeline._test.setMongoDbOverride(database(() => write.promise));
    pipeline.start(); pipeline.enqueue(record('a')); await expire(10);
    pipeline.shutdown(); await expire(); write.resolve(); await tick();
    expect(vi.getTimerCount()).toBe(0); expect(pipeline.getState().isSchedulerActive).toBe(false);
  });

  it('atomically replaces recovery with a private complete snapshot and leaves no temp files', async () => {
    fs.writeFileSync(recovery, 'old\n', { mode: 0o644 });
    pipeline._test.setMongoDbOverride(null); pipeline.enqueue(record('new')); await pipeline.shutdown();
    expect(contents()).toEqual([record('new')]); expect(fs.statSync(recovery).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(directory)).toEqual(['recovery.jsonl']);
  });

  it('preserves an older recovery snapshot and memory if replacement fails', async () => {
    fs.mkdirSync(recovery); fs.writeFileSync(path.join(recovery, 'previous'), 'saved');
    pipeline._test.setMongoDbOverride(null); pipeline.enqueue(record('retained')); await pipeline.shutdown();
    expect(fs.readFileSync(path.join(recovery, 'previous'), 'utf8')).toBe('saved');
    expect(pipeline.getState().bufferSize).toBe(1); expect(fs.readdirSync(directory)).toEqual(['recovery.jsonl']);
  });

  it('a fresh process instance recovers the actual checkpoint and flushes it', async () => {
    pipeline._test.setMongoDbOverride(null); pipeline.enqueue(record('recovered')); await pipeline.shutdown();
    const next = await newInstance(); const insert = vi.fn().mockResolvedValue({});
    next._test.setMongoDbOverride(database(insert)); next.start(); await next.flush();
    expect(insert).toHaveBeenCalledWith([record('recovered')], { ordered: false });
    expect(fs.existsSync(recovery)).toBe(false); await next.shutdown(); next._test.reset();
  });

  it('preserves ordinary flush coalescing, arrival ordering, and transient retry metrics', async () => {
    const write = deferred(); const insert = vi.fn().mockImplementationOnce(() => write.promise).mockResolvedValue({});
    pipeline._test.setMongoDbOverride(database(insert)); pipeline.enqueue(record('first'));
    const first = pipeline.flush(); expect(pipeline.flush()).toBe(first); pipeline.enqueue(record('second'));
    write.reject(new Error('transient')); await first;
    expect(pipeline.getBuffer().toArray()).toEqual(['first', 'second'].map(record));
    await pipeline.flush(); expect(pipeline.getMetrics().eventsFlushed).toBe(2);
    expect(pipeline.getMetrics().retryCount).toBe(1); await pipeline.shutdown();
  });

  it('preserves bounded overflow while a shutdown write remains in flight', async () => {
    const write = deferred(); pipeline._test.setMongoDbOverride(database(() => write.promise));
    pipeline.enqueue(record('owned')); pipeline.flush(); pipeline.shutdown();
    for (let i = 0; i < 6; i++) pipeline.enqueue(record(String(i)));
    await expire(); expect(contents()).toEqual(['owned', '2', '3', '4', '5'].map(record));
    expect(pipeline.getMetrics().overflowDropped).toBe(2); write.resolve(); await tick();
  });
});
