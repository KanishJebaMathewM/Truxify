import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Redis from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({redis:null}));
vi.mock('node-cron',()=>({default:{schedule:vi.fn()}}));
vi.mock('../../src/config/db.js',()=>({supabase:{},supabaseAdmin:{},get redisClient(){return state.redis;}}));
vi.mock('../../src/middleware/logger.js',()=>({default:{info:vi.fn(),error:vi.fn(),warn:vi.fn()}}));
vi.mock('../../src/services/notificationService.js',()=>({sendPushNotification:vi.fn()}));
vi.mock('../../src/services/escrow.js',()=>({submitEscrowRefund:vi.fn(),confirmEscrowRefund:vi.fn()}));
vi.mock('../../src/core/telemetry/WorkerTracer.js',()=>({WorkerTracer:{wrapCronJob:(_n,fn)=>fn}}));
vi.mock('../../src/core/telemetry/SpanFactory.js',()=>({default:{getActiveSpan:()=>null}}));
let directory,server,clients=[],run,repository;
const key='stale:order:cancellation:lock';
// Native integration is explicit in the focused gate; ordinary unit discovery needs no Redis binary.
describe.skipIf(!process.env.STALE_NATIVE_REDIS)('isolated native Redis worker lease', () => {
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'truxify-stalelease-'));
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
  clients = Array.from({ length: 2 }, () => new Redis(socket));
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
beforeEach(async()=>{
 await clients[0].flushdb();state.redis=clients[0];vi.resetModules();
 ({reconcileStaleOrders:run}=await import('../../src/workers/staleOrderWorker.js'));
 repository={findStalePendingOrders:vi.fn(async()=>({data:[{id:'fixture'}],error:null})),cancelStaleOrder:vi.fn(async()=>({data:[],error:null})),updateLoadOffer:vi.fn()};
});
afterEach(()=>vi.restoreAllMocks());
it('native owner renewal and cleanup leave no lock after normal work',async()=>{
 const evaluate=vi.spyOn(clients[0],'eval');await run(repository);expect(repository.cancelStaleOrder).toHaveBeenCalledTimes(1);expect(evaluate.mock.calls.some(c=>c[0].includes("redis.call('EXPIRE'"))).toBe(true);expect(evaluate.mock.calls.some(c=>c[0].includes("redis.call('DEL'"))).toBe(true);expect(await clients[0].get(key)).toBe(null);
});
it('native replacement is not renewed or released by stale worker',async()=>{
 repository.findStalePendingOrders.mockImplementation(async()=>{await clients[1].set(key,'successor','EX',33);return {data:[{id:'fixture'}],error:null};});await run(repository);expect(repository.cancelStaleOrder).not.toHaveBeenCalled();expect(await clients[1].get(key)).toBe('successor');expect(await clients[1].ttl(key)).toBeGreaterThanOrEqual(32);expect(await clients[1].ttl(key)).toBeLessThanOrEqual(33);
});
it('native missing key closes admission without re-acquisition',async()=>{
 const acquire=vi.spyOn(clients[0],'set');repository.findStalePendingOrders.mockImplementation(async()=>{await clients[1].del(key);return {data:[{id:'fixture'}],error:null};});await run(repository);expect(repository.cancelStaleOrder).not.toHaveBeenCalled();expect(acquire).toHaveBeenCalledTimes(1);expect(await clients[0].get(key)).toBe(null);
});
it('the actual captured Lua rejects wrong tokens and expired owners atomically',async()=>{
 const evaluate=vi.spyOn(clients[0],'eval');await run(repository);
 const renew=evaluate.mock.calls.find(c=>c[0].includes("redis.call('EXPIRE'"))[0];
 const release=evaluate.mock.calls.find(c=>c[0].includes("redis.call('DEL'"))[0];
 await clients[0].set(key,'current','EX',33);
 expect(await clients[1].eval(renew,1,key,'old',120)).toBe(0);expect(await clients[1].eval(release,1,key,'old')).toBe(0);expect(await clients[0].get(key)).toBe('current');expect(await clients[0].ttl(key)).toBeLessThanOrEqual(33);
 expect(await clients[1].eval(renew,1,key,'current',120)).toBe(1);expect(await clients[0].ttl(key)).toBeGreaterThanOrEqual(119);
 await clients[0].pexpire(key,1);await new Promise(resolve=>setTimeout(resolve,20));expect(await clients[0].get(key)).toBe(null);
 await clients[0].set(key,'successor','EX',33);expect(await clients[1].eval(release,1,key,'current')).toBe(0);expect(await clients[1].eval(renew,1,key,'current',120)).toBe(0);expect(await clients[0].get(key)).toBe('successor');
});

});
