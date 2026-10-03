import net from 'node:net';
import pg from 'pg';
import { describe, it, expect, vi, afterEach } from 'vitest';
vi.mock('../../src/config/db.js',()=>({redisClient:null,pgPool:null}));
vi.mock('../../src/middleware/logger.js',()=>({default:{info:vi.fn(),warn:vi.fn(),error:vi.fn()}}));
import manager from '../../src/services/sharding/ShardManager.js';
import { executeOwnedShardQuery, DEFAULT_SHARD_QUERY_TIMEOUT_MS, MAX_PENDING_SHARD_QUERIES } from '../../src/services/sharding/ownedShardQuery.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const clientFor=query=>({query:vi.fn(query),release:vi.fn()});
const run=pool=>executeOwnedShardQuery(pool,'SELECT 1',[],{timeoutMs:30,shard:'north'});
const flush=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};
afterEach(()=>{vi.useRealTimers();});
function install(pool){for(const shard of manager.shards.values())shard.pool=null;manager.shards.get('north').pool=pool;}

describe('owned checkout and query lifetime',()=>{
 it('success releases exactly once without an error',async()=>{
   const client=clientFor(async()=>({rows:[{ok:1}]}));expect(await run({connect:async()=>client})).toEqual({rows:[{ok:1}]});
   expect(client.release).toHaveBeenCalledExactlyOnceWith(undefined);
 });
 it('synchronous query failure destroys the client once',async()=>{
   const error=new Error('bad query');const client=clientFor(()=>{throw error;});await expect(run({connect:async()=>client})).rejects.toBe(error);expect(client.release).toHaveBeenCalledExactlyOnceWith(error);
 });
 it('checkout failure does not invent a release',async()=>{
   await expect(run({connect:async()=>{throw new Error('offline');}})).rejects.toThrow('offline');
 });
 it('late checkout is destroyed without starting SQL',async()=>{
   vi.useFakeTimers();const checkout=deferred(),client=clientFor(async()=>({rows:[]}));const result=run({connect:()=>checkout.promise}).catch(e=>e);
   await vi.advanceTimersByTimeAsync(31);expect((await result).code).toBe('ETIMEDOUT');checkout.resolve(client);await flush();
   expect(client.query).not.toHaveBeenCalled();expect(client.release).toHaveBeenCalledTimes(1);expect(client.release.mock.calls[0][0].code).toBe('ETIMEDOUT');
 });
 it('query timeout destroys client once and ignores its late result',async()=>{
   vi.useFakeTimers();const query=deferred(),client=clientFor(()=>query.promise);const result=run({connect:async()=>client}).catch(e=>e);
   await vi.advanceTimersByTimeAsync(31);expect((await result).code).toBe('ETIMEDOUT');expect(client.release).toHaveBeenCalledTimes(1);
   query.resolve({rows:[{late:1}]});await flush();expect(client.release).toHaveBeenCalledTimes(1);
 });
 it('late checkout rejection is observed after timeout',async()=>{
   vi.useFakeTimers();const checkout=deferred();const result=run({connect:()=>checkout.promise}).catch(e=>e);
   await vi.advanceTimersByTimeAsync(31);expect((await result).code).toBe('ETIMEDOUT');checkout.reject(new Error('late rejection'));await flush();
 });
 it('retains bounded admission after callers time out until checkout settles',async()=>{
   vi.useFakeTimers();const checkouts=[];const pool={connect:vi.fn(()=>{const d=deferred();checkouts.push(d);return d.promise;})};
   const callers=Array.from({length:MAX_PENDING_SHARD_QUERIES},()=>run(pool).catch(e=>e));await flush();
   await vi.advanceTimersByTimeAsync(31);expect((await Promise.all(callers)).every(e=>e.code==='ETIMEDOUT')).toBe(true);
   for(let i=0;i<50;i++)expect((await run(pool).catch(e=>e)).code).toBe('ESHARDSATURATED');
   expect(pool.connect).toHaveBeenCalledTimes(MAX_PENDING_SHARD_QUERIES);
   const clients=checkouts.map(()=>clientFor(async()=>({rows:[]})));checkouts.forEach((d,i)=>d.resolve(clients[i]));await flush();
   for(const c of clients){expect(c.query).not.toHaveBeenCalled();expect(c.release).toHaveBeenCalledTimes(1);}
   pool.connect.mockResolvedValue(clientFor(async()=>({rows:[{ok:1}]})));expect((await run(pool)).rows).toEqual([{ok:1}]);
 });
 it('capacity is independent per native pool',async()=>{
   vi.useFakeTimers();const stuck={connect:()=>new Promise(()=>{})};const callers=Array.from({length:MAX_PENDING_SHARD_QUERIES},()=>run(stuck).catch(e=>e));await flush();
   expect((await run({connect:async()=>clientFor(async()=>({rows:[{healthy:1}]}))})).rows).toEqual([{healthy:1}]);
   await vi.advanceTimersByTimeAsync(31);await Promise.all(callers);
 });
 it('deadline starts before checkout and remaining query budget is smaller',async()=>{
   vi.useFakeTimers({toFake:['setTimeout','clearTimeout','performance']});const checkout=deferred(),client=clientFor(async()=>({rows:[]}));const result=run({connect:()=>checkout.promise});
   await vi.advanceTimersByTimeAsync(20);checkout.resolve(client);await result;expect(client.query.mock.calls[0][0].query_timeout).toBeLessThanOrEqual(10);
 });
});

describe('actual manager integration',()=>{
 it('default deadline prevents omitted-timeout calls from waiting forever',async()=>{
   vi.useFakeTimers();const checkout=deferred();const client=clientFor(async()=>({rows:[]}));install({connect:()=>checkout.promise,query:()=>checkout.promise});
   const result=manager.executeCrossShardQuery('SELECT 1');await vi.advanceTimersByTimeAsync(DEFAULT_SHARD_QUERY_TIMEOUT_MS+1);
   const response=await result;expect(response.failed).toContain('north');expect(response.errors.north).toMatch(/timed out/);
   checkout.resolve(client);await flush();expect(client.query).not.toHaveBeenCalled();
 });
 for(const timeoutMs of [0,-1,Infinity,NaN,'30',30001]){
   it(`invalid timeout ${String(timeoutMs)} is rejected before native admission`,async()=>{
     const pool={connect:vi.fn(),query:vi.fn()};install(pool);await expect(manager.executeCrossShardQuery('SELECT 1',{timeoutMs})).rejects.toThrow('timeoutMs');expect(pool.connect).not.toHaveBeenCalled();expect(pool.query).not.toHaveBeenCalled();
   });
 }
 it('mixed owned-query success and failure preserve metadata and sorted pagination',async()=>{
   install({connect:async()=>clientFor(async()=>({rows:[{id:3},{id:1}]}))});
   manager.shards.get('south').pool={connect:async()=>clientFor(async()=>({rows:[{id:2}]}))};
   manager.shards.get('east').pool={connect:async()=>{throw new Error('east unavailable');}};
   const result=await manager.executeCrossShardQuery('SELECT id FROM orders',{mergeResults:true,structured:true,sortField:'id',offset:1,limit:1});
   expect(result.data).toEqual([{id:2}]);expect(result.healthy).toEqual(['north','south']);expect(result.failed).toEqual(['east','west']);expect(result.errors.east).toBe('east unavailable');expect(result.partial).toBe(true);
 });
 it('query timeout cannot dispatch following a late checkout or appear healthy',async()=>{
   vi.useFakeTimers();const checkout=deferred(),client=clientFor(async()=>({rows:[{late:1}]}));install({connect:()=>checkout.promise,query:()=>checkout.promise});
   const result=manager.executeCrossShardQuery('SELECT 1',{timeoutMs:30});await vi.advanceTimersByTimeAsync(31);expect((await result).healthy).toEqual([]);
   checkout.resolve(client);await flush();expect(client.query).not.toHaveBeenCalled();
 });
});

async function waitClosed(wire) {
 let timer;
 try { await Promise.race([wire.closed.promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('socket not retired after deadline')),500);})]); }
 finally { clearTimeout(timer); }
}

async function wireFixture({delayStartup=false,stallQuery=false}={}){
 const sockets=new Set(),startup=deferred(),querySeen=deferred(),closed=deferred();let queries=0;
 const ready=Buffer.from([82,0,0,0,8,0,0,0,0,90,0,0,0,5,73]);
 const server=net.createServer(socket=>{
   sockets.add(socket);let first=true,buffer=Buffer.alloc(0);
   socket.on('error',()=>{});socket.on('close',()=>{sockets.delete(socket);closed.resolve();});
   socket.on('data',data=>{
     buffer=Buffer.concat([buffer,data]);
     while(buffer.length>=5){const length=first?buffer.readInt32BE(0):buffer.readInt32BE(1)+1;if(buffer.length<length)return;
       const packet=buffer.subarray(0,length);buffer=buffer.subarray(length);
       if(first){first=false;startup.resolve(socket);if(!delayStartup)socket.write(ready);}
       else if(packet[0]===81){queries++;querySeen.resolve();if(!stallQuery)socket.write(Buffer.from([67,0,0,0,13,...Buffer.from('SELECT 0\0'),90,0,0,0,5,73]));}
     }
   });
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const pool=new pg.Pool({host:'127.0.0.1',port:server.address().port,user:'fixture',database:'fixture',max:1,connectionTimeoutMillis:1000});
 return {pool,startup,querySeen,closed,ready,get queries(){return queries;},async cleanup(){for(const socket of sockets)socket.destroy();await pool.end();await new Promise(r=>server.close(r));}};
}

describe('native pg loopback protocol lifecycle (no remote database)',()=>{
 it('native late startup cannot dispatch SQL after the manager timeout',async()=>{
   const wire=await wireFixture({delayStartup:true});install(wire.pool);
   try{const result=manager.executeCrossShardQuery('SELECT 1',{timeoutMs:100});const socket=await wire.startup.promise;
     expect((await result).failed).toContain('north');socket.write(wire.ready);
     await waitClosed(wire);expect(wire.queries).toBe(0);expect(wire.pool.totalCount).toBe(0);
   }finally{await wire.cleanup();}
 },5000);
 it('native unfinished query retires the owned socket on timeout',async()=>{
   const wire=await wireFixture({stallQuery:true});install(wire.pool);
   try{const result=manager.executeCrossShardQuery('SELECT 1',{timeoutMs:150});await wire.querySeen.promise;
     expect((await result).failed).toContain('north');await waitClosed(wire);expect(wire.queries).toBe(1);expect(wire.pool.totalCount).toBe(0);
   }finally{await wire.cleanup();}
 },5000);
 it('native successful query returns the client to its pool',async()=>{
   const wire=await wireFixture();install(wire.pool);
   try{expect((await manager.executeCrossShardQuery('SELECT 1',{timeoutMs:1000})).healthy).toEqual(['north']);expect(wire.queries).toBe(1);expect(wire.pool.idleCount).toBe(1);
   }finally{await wire.cleanup();}
 });
});
