import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({redis:null,clock:0,notify:vi.fn(),refund:vi.fn(),warn:vi.fn()}));
vi.mock('node:perf_hooks',()=>({performance:{now:()=>state.clock}}));
vi.mock('node-cron',()=>({default:{schedule:vi.fn()}}));
vi.mock('../../src/config/db.js',()=>({supabase:{},supabaseAdmin:{},get redisClient(){return state.redis;}}));
vi.mock('../../src/middleware/logger.js',()=>({default:{info:vi.fn(),error:vi.fn(),warn:state.warn}}));
vi.mock('../../src/services/notificationService.js',()=>({sendPushNotification:state.notify}));
vi.mock('../../src/services/escrow.js',()=>({submitEscrowRefund:state.refund,confirmEscrowRefund:vi.fn()}));
vi.mock('../../src/core/telemetry/WorkerTracer.js',()=>({WorkerTracer:{wrapCronJob:(_n,fn)=>fn}}));
vi.mock('../../src/core/telemetry/SpanFactory.js',()=>({default:{getActiveSpan:()=>null}}));
const key='stale:order:cancellation:lock';
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
let store,repository,run;
function ledger() {
 return {owner:null,renewed:0,released:0,set:vi.fn(async(_k,token)=>{if(store.owner!==null)return null;store.owner=token;return 'OK';}),
 eval:vi.fn(async(script,_n,_k,token)=>{if(store.owner!==token)return 0;if(script.includes("redis.call('DEL'")){store.owner=null;store.released++;return 1;}store.renewed++;return 1;}),
 expire:vi.fn(async()=>{store.renewed++;return 1;}),del:vi.fn(async()=>{store.owner=null;store.released++;return 1;})};
}
beforeEach(async()=>{
 vi.useFakeTimers();state.clock=0;store=ledger();state.redis=store;state.notify.mockReset();state.refund.mockReset();state.warn.mockReset();
 repository={findStalePendingOrders:vi.fn(async()=>({data:Array.from({length:10},(_,i)=>({id:'order-'+i})),error:null})),cancelStaleOrder:vi.fn(async()=>({data:[],error:null})),updateLoadOffer:vi.fn(async()=>({error:null}))};
 vi.resetModules();({reconcileStaleOrders:run}=await import('../../src/workers/staleOrderWorker.js'));
});
afterEach(()=>{vi.useRealTimers();delete process.env.STALE_ORDER_WORKER_BATCH_SIZE;});
it('new sweeps use distinct owner tokens rather than a shared PID',async()=>{await run(repository);await run(repository);const tokens=store.set.mock.calls.map(c=>c[1]);expect(new Set(tokens).size).toBe(2);expect(tokens.every(t=>t!==String(process.pid))).toBe(true);expect(store.del).not.toHaveBeenCalled();expect(store.expire).not.toHaveBeenCalled();});
it('replacement during fetch prevents any cancellation and cannot renew/delete successor',async()=>{
 repository.findStalePendingOrders.mockImplementation(async()=>{store.owner='successor';return {data:[{id:'fixture'}],error:null};});await run(repository);expect(repository.cancelStaleOrder).not.toHaveBeenCalled();expect(store.owner).toBe('successor');expect(store.renewed).toBe(0);expect(store.released).toBe(0);
});
it('missing key is a permanent loss, never re-acquired within the sweep',async()=>{
 repository.findStalePendingOrders.mockImplementation(async()=>{store.owner=null;return {data:[{id:'fixture'}],error:null};});await run(repository);expect(repository.cancelStaleOrder).not.toHaveBeenCalled();expect(store.set).toHaveBeenCalledTimes(1);
});
it('renewal error closes admission and cleanup only uses compare-release',async()=>{const original=store.eval;store.eval=vi.fn((script,...args)=>script.includes("redis.call('DEL'")?original(script,...args):Promise.reject(new Error('offline')));await run(repository);expect(repository.cancelStaleOrder).not.toHaveBeenCalled();expect(state.warn).toHaveBeenCalled();expect(store.owner).toBe(null);});
it('slow acquisition cannot admit after its local lease deadline',async()=>{store.set.mockImplementation(async(_k,token)=>{store.owner=token;state.clock=120001;return 'OK';});await run(repository);expect(repository.findStalePendingOrders).not.toHaveBeenCalled();expect(store.owner).toBe(null);});
it('slow positive renewal cannot revive an expired local lease',async()=>{const original=store.eval;store.eval=vi.fn(async(script,...args)=>{if(!script.includes("redis.call('DEL'"))state.clock=120001;return original(script,...args);});await run(repository);expect(repository.cancelStaleOrder).not.toHaveBeenCalled();});
it('heartbeat keeps lease renewed across a slow candidate fetch',async()=>{
 const gate=deferred();repository.findStalePendingOrders.mockReturnValue(gate.promise);const task=run(repository);await vi.waitFor(()=>expect(repository.findStalePendingOrders).toHaveBeenCalled());state.clock=40000;await vi.advanceTimersByTimeAsync(40000);state.clock=80000;await vi.advanceTimersByTimeAsync(40000);state.clock=120000;await vi.advanceTimersByTimeAsync(40000);expect(store.renewed).toBe(3);gate.resolve({data:[{id:'fixture'}],error:null});await task;expect(repository.cancelStaleOrder).toHaveBeenCalledTimes(1);
});
it('heartbeat loss drains admitted work and retains the process guard',async()=>{
 const gate=deferred();repository.cancelStaleOrder.mockReturnValue(gate.promise);const task=run(repository);await vi.waitFor(()=>expect(repository.cancelStaleOrder).toHaveBeenCalledTimes(5));store.owner='successor';state.clock=40000;await vi.advanceTimersByTimeAsync(40000);await run(repository);expect(repository.findStalePendingOrders).toHaveBeenCalledTimes(1);gate.resolve({data:[],error:null});await task;expect(repository.cancelStaleOrder).toHaveBeenCalledTimes(5);expect(store.owner).toBe('successor');expect(vi.getTimerCount()).toBe(0);
});
it('two separately loaded replicas cannot acquire the same live lease',async()=>{
 const gate=deferred();repository.findStalePendingOrders.mockReturnValue(gate.promise);const a=run(repository);await vi.waitFor(()=>expect(repository.findStalePendingOrders).toHaveBeenCalled());vi.resetModules();const {reconcileStaleOrders:b}=await import('../../src/workers/staleOrderWorker.js');await b(repository);expect(repository.findStalePendingOrders).toHaveBeenCalledTimes(1);gate.resolve({data:[],error:null});await a;
});
it('only five CAS operations are admitted at once, then remaining work drains',async()=>{
 const gate=deferred();repository.cancelStaleOrder.mockReturnValue(gate.promise);const task=run(repository);await vi.waitFor(()=>expect(repository.cancelStaleOrder).toHaveBeenCalledTimes(5));expect(store.set).toHaveBeenCalledTimes(1);gate.resolve({data:[],error:null});await task;expect(repository.cancelStaleOrder).toHaveBeenCalledTimes(10);
});
it('no Redis retains explicitly process-local behavior',async()=>{state.redis=null;await run(repository);expect(repository.cancelStaleOrder).toHaveBeenCalledTimes(10);expect(store.set).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);});
it('acquisition error does not fetch and a later fresh sweep remains possible',async()=>{store.set.mockRejectedValueOnce(new Error('offline'));await run(repository);expect(repository.findStalePendingOrders).not.toHaveBeenCalled();await run(repository);expect(repository.cancelStaleOrder).toHaveBeenCalledTimes(10);});
it('release failure does not leave the local guard stuck',async()=>{repository.findStalePendingOrders.mockResolvedValue({data:[],error:null});store.eval.mockRejectedValueOnce(new Error('release down'));await run(repository);store.owner=null;await run(repository);expect(repository.findStalePendingOrders).toHaveBeenCalledTimes(2);expect(vi.getTimerCount()).toBe(0);});
it('fetch failure clears heartbeat and releases only its own lease',async()=>{repository.findStalePendingOrders.mockRejectedValue(new Error('database offline'));await run(repository);expect(store.owner).toBe(null);expect(repository.cancelStaleOrder).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);});
for(const [raw,want] of [['-1',100],['Infinity',100],['3.9',3],['999999',1000]]) it(`batch setting ${raw} is bounded to${want}`,async()=>{process.env.STALE_ORDER_WORKER_BATCH_SIZE=raw;await run(repository);expect(repository.findStalePendingOrders).toHaveBeenCalledWith(expect.any(String),want);expect(repository.cancelStaleOrder.mock.calls.length).toBe(Math.min(want,10));});
it('lost CAS/error rows trigger no downstream effect; a won row keeps existing effects',async()=>{
 repository.findStalePendingOrders.mockResolvedValue({data:[{id:'lost'},{id:'error'},{id:'won'}],error:null});repository.cancelStaleOrder.mockImplementation(async id=>id==='lost'?{data:[],error:null}:id==='error'?{data:null,error:{message:'fail'}}:{data:[{id:'won',order_display_id:'fixture',customer_id:'customer',escrow_status:'pending'}],error:null});await run(repository);expect(repository.updateLoadOffer).toHaveBeenCalledTimes(1);expect(state.notify).toHaveBeenCalledTimes(1);expect(state.refund).not.toHaveBeenCalled();
});
