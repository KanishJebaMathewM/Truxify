// run.sh copies actual service/repository source unchanged; provider/transport seams are controlled.
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
const state = vi.hoisted(() => ({ redis: null, route: null, cacheHook: null }));
vi.mock('../../src/config/db.js', () => ({ get redisClient() { return state.redis; }, supabaseAdmin: null }));
vi.mock('../../src/middleware/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../src/services/osrm.js', () => ({ getRouteEstimate: args => state.route(args) }));
vi.mock('../../src/services/trafficService.js', () => ({ getLiveTrafficMultiplier: async () => 1 }));
vi.mock('../../src/services/routingService.js', () => ({ getHaversineDistance: (a, b, c, d) => Math.hypot(a-c, b-d)*111 }));
vi.mock('../../src/sockets/tracker.js', () => ({ broadcastOrderEta: vi.fn() }));
vi.mock('../../src/sockets/locationServer.js', () => ({ emitEtaUpdateToBooking: vi.fn() }));
import { OrderRepository } from '../../src/repositories/orderRepository.js';
import { calculateInitialEtaAfterAssignment, maybeRecalculateEtaOnLocationUpdate, persistAndBroadcastEta,
  scheduleEtaRecalculationOnLocationUpdate, scheduleInitialEtaAfterAssignment, resolveDestinationForOrder,
  formatEtaDisplay, hasMeaningfulMovement, isMeaningfulEtaChange } from '../../src/services/order/etaService.js';
import { broadcastOrderEta } from '../../src/sockets/tracker.js';
import { emitEtaUpdateToBooking } from '../../src/sockets/locationServer.js';
let pg, repo, cache, client;
const id = '00000000-0000-4000-8000-000000000001';
const driver = '00000000-0000-4000-8000-000000000002';
const other = '00000000-0000-4000-8000-000000000003';
const migration = readFileSync(new URL('../../../../supabase/migrations/20261002174206_eta_calculation_generation.sql', import.meta.url), 'utf8');
const rpcArgs = {
  claim_order_eta_generation: ['p_order_id','p_driver_id','p_expected_status'],
  commit_order_eta_generation: ['p_order_id','p_driver_id','p_expected_status','p_generation','p_eta','p_arrival_epoch_ms','p_change_threshold_seconds'],
};
const params = { orderRepository: null, orderId: id, driverId: driver, lat: 10, lng: 20 };
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
async function row() { return (await pg.query('SELECT * FROM orders WHERE id=$1',[id])).rows[0]; }
async function claim() { return (await repo.claimEtaGeneration(id, driver, 'in_transit')).data; }
async function commit(generation, patch={}) {
  return repo.commitEtaGeneration({ orderId:id, driverId:driver, expectedStatus:'in_transit', generation,
    etaText:'estimate', arrivalEpochMs:1700000000000, thresholdSeconds:120, ...patch });
}
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE orders(id uuid PRIMARY KEY,driver_id uuid,status text,order_display_id text,eta text,updated_at timestamptz,
      pickup_lat double precision,pickup_lng double precision,drop_lat double precision,drop_lng double precision);`);
  await pg.exec(migration);
},30000);
beforeEach(async () => {
  vi.clearAllMocks(); state.cacheHook=null;
  await pg.exec('RESET ROLE; ALTER TABLE orders DISABLE ROW LEVEL SECURITY; DROP POLICY IF EXISTS fixture_row ON orders; TRUNCATE orders;');
  await pg.query("INSERT INTO orders(id,driver_id,status,order_display_id,pickup_lat,pickup_lng,drop_lat,drop_lng) VALUES($1,$2,'in_transit','TX-ETA',11,21,12,22)",[id,driver]);
  cache=new Map([['driver:location:'+driver,JSON.stringify({lat:10,lng:20})]]);
  state.redis={get:vi.fn(async k=>cache.get(k)??null),set:vi.fn(async(k,v)=>{ if(state.cacheHook) await state.cacheHook(k,v); cache.set(k,v); return 'OK'; }),incr:vi.fn(async k=>{const n=Number(cache.get(k)||0)+1;cache.set(k,String(n));return n;}),expire:vi.fn(async()=>1)};
  state.route=vi.fn(async()=>({durationSeconds:600}));
  client={
    rpc:vi.fn(async(name,args)=>{
      const keys=rpcArgs[name]; if(!keys) throw new Error('Unexpected RPC '+name);
      const result=await pg.query(`SELECT public.${name}(${keys.map((_,i)=>'$'+(i+1)).join(',')}) AS result`,keys.map(k=>args[k]));
      return {data:result.rows[0].result,error:null};
    }),
    from(table) {
      expect(table).toBe('orders'); let columns='*', patch=null; const values=[], clauses=[];
      function safe(column){if(!/^[a-z_]+$/.test(column))throw new Error('Unsafe fixture column');return column;}
      const q={
        select(c){ columns=c; return q; }, update(p){patch=p;return q;},
        eq(k,v){values.push(v);clauses.push(`${safe(k)}=$${values.length}`);return q;},
        in(k,v){values.push(v);clauses.push(`${safe(k)}=ANY($${values.length})`);return q;},
        async maybeSingle(){return q.single();},
        async single(){
          if(columns!=='*')columns.split(',').forEach(c=>safe(c.trim()));
          let sql=`SELECT ${columns} FROM orders WHERE ${clauses.join(' AND ')}`;
          if(patch){const sets=Object.entries(patch).map(([k,v])=>{values.push(v);return `${safe(k)}=$${values.length}`;});sql=`UPDATE orders SET ${sets.join(',')} WHERE ${clauses.join(' AND ')} RETURNING ${columns}`;}
          const result=await pg.query(sql,values);return {data:result.rows[0]??null,error:null};
        },
      };return q;
    },
  };
  repo=new OrderRepository(client); params.orderRepository=repo;
});
afterAll(async()=>{await pg.close();});

describe('actual service entry points with PostgreSQL generation ownership',()=>{
  for(const redisMode of ['working','absent','error']) {
    it(`location delayed older route cannot overwrite successor with Redis ${redisMode}`,async()=>{
      if(redisMode==='absent')state.redis=null;
      if(redisMode==='error'){state.redis.get.mockRejectedValue(new Error('offline'));state.redis.set.mockRejectedValue(new Error('offline'));state.redis.incr.mockRejectedValue(new Error('offline'));}
      const started=deferred(), release=deferred();let calls=0;
      state.route=vi.fn(async()=>{if(++calls===1){started.resolve();await release.promise;return {durationSeconds:1200};}return {durationSeconds:600};});
      const old=maybeRecalculateEtaOnLocationUpdate(params);await started.promise;
      await maybeRecalculateEtaOnLocationUpdate({...params,lat:11}); const fresh=await row();
      release.resolve();await old;
      expect((await row()).eta).toBe(fresh.eta);
      expect((await row()).eta_arrival_epoch_ms).toBe(fresh.eta_arrival_epoch_ms);
      expect(broadcastOrderEta).toHaveBeenCalledTimes(1); expect(emitEtaUpdateToBooking).toHaveBeenCalledTimes(1);
      if(redisMode==='working')expect(JSON.parse(cache.get('driver:eta:last-pos:'+driver))).toEqual({lat:11,lng:20});
    });
  }
  it('initial helper delayed before routing loses to live location helper and records no older movement',async()=>{
    const started=deferred(),release=deferred();let calls=0;
    state.route=vi.fn(async()=>{if(++calls===1){started.resolve();await release.promise;return {durationSeconds:1200};}return {durationSeconds:600};});
    const old=calculateInitialEtaAfterAssignment(params);await started.promise;
    await maybeRecalculateEtaOnLocationUpdate({...params,lat:11});const fresh=await row();release.resolve();await old;
    expect((await row()).eta).toBe(fresh.eta);expect(broadcastOrderEta).toHaveBeenCalledTimes(1);
    expect(JSON.parse(cache.get('driver:eta:last-pos:'+driver))).toEqual({lat:11,lng:20});
  });
  for(const entry of [calculateInitialEtaAfterAssignment,maybeRecalculateEtaOnLocationUpdate]){
    it(`${entry.name} rejects failed claim without routing or fallback`,async()=>{
      client.rpc.mockRejectedValue(new Error('migration missing'));await entry(params);
      expect(state.route).not.toHaveBeenCalled();expect(broadcastOrderEta).not.toHaveBeenCalled();expect((await row()).eta).toBeNull();
    });
    it(`${entry.name} rejects failed commit without movement publication`,async()=>{
      vi.spyOn(repo,'commitEtaGeneration').mockResolvedValue({data:null,error:{message:'DB unavailable'}});await entry(params);
      expect(cache.has('driver:eta:last-pos:'+driver)).toBe(false);expect(broadcastOrderEta).not.toHaveBeenCalled();
    });
    it(`${entry.name} preserves destination and payload for a successful estimate`,async()=>{
      await entry(params);expect(state.route).toHaveBeenCalledWith({pickupLat:10,pickupLng:20,dropLat:12,dropLng:22});
      expect(broadcastOrderEta).toHaveBeenCalledWith('TX-ETA',(await row()).eta);expect(emitEtaUpdateToBooking).toHaveBeenCalledWith('TX-ETA',(await row()).eta);
    });
  }
  for(const change of ["status='delivered'","status='arriving'",`driver_id='${other}'`]){
    it(`lifecycle change ${change} while routing rejects commit and movement`,async()=>{
      state.route=async()=>{await pg.exec(`UPDATE orders SET ${change}`);return {durationSeconds:600};};
      await maybeRecalculateEtaOnLocationUpdate(params);expect((await row()).eta).toBeNull();expect(broadcastOrderEta).not.toHaveBeenCalled();expect(cache.has('driver:eta:last-pos:'+driver)).toBe(false);
    });
  }
  it('known supersession after cache await suppresses broadcast and movement',async()=>{
    state.cacheHook=async k=>{if(k.startsWith('order:eta:arrival-epoch:'))await claim();};
    await maybeRecalculateEtaOnLocationUpdate(params);
    expect((await row()).eta).not.toBeNull();expect(broadcastOrderEta).not.toHaveBeenCalled();expect(cache.has('driver:eta:last-pos:'+driver)).toBe(false);
  });
  it('fresh-read error suppresses best-effort publication',async()=>{
    vi.spyOn(repo,'findEtaGeneration').mockRejectedValue(new Error('read unavailable'));
    await maybeRecalculateEtaOnLocationUpdate(params);expect((await row()).eta).not.toBeNull();expect(broadcastOrderEta).not.toHaveBeenCalled();
  });
  it('failed route does not record successful movement',async()=>{
    state.route=async()=>null;await calculateInitialEtaAfterAssignment(params);expect(cache.has('driver:eta:last-pos:'+driver)).toBe(false);
  });
  it('movement threshold avoids unnecessary claims and provider calls',async()=>{
    cache.set('driver:eta:last-pos:'+driver,JSON.stringify({lat:10,lng:20}));await maybeRecalculateEtaOnLocationUpdate(params);
    expect(client.rpc).not.toHaveBeenCalled();expect(state.route).not.toHaveBeenCalled();
  });
  it('terminal status and wrong driver skip the route',async()=>{
    await pg.exec("UPDATE orders SET status='delivered'");await maybeRecalculateEtaOnLocationUpdate(params);
    await pg.exec(`UPDATE orders SET status='in_transit',driver_id='${other}'`);await calculateInitialEtaAfterAssignment(params);expect(state.route).not.toHaveBeenCalled();
  });
  it('scheduling wrappers return immediately and contain calculation failures',async()=>{
    expect(scheduleInitialEtaAfterAssignment({})).toBeUndefined();expect(scheduleEtaRecalculationOnLocationUpdate({})).toBeUndefined();
    const done=deferred();client.rpc.mockImplementation(async()=>{done.resolve();throw new Error('offline');});
    expect(scheduleEtaRecalculationOnLocationUpdate(params)).toBeUndefined();await done.promise;
  });
});

describe('real PostgreSQL protocol through actual OrderRepository',()=>{
  it('unique generations fence old writers and preserve durable arrival threshold',async()=>{
    const old=await claim(), fresh=await claim();expect(old).not.toBe(fresh);
    expect((await commit(fresh)).data.eta).toBe('estimate');expect((await commit(old,{etaText:'stale',arrivalEpochMs:1700001000000})).data).toBeNull();
    expect((await commit(fresh,{arrivalEpochMs:1700000119999})).data).toBeNull();
    expect((await commit(fresh,{arrivalEpochMs:1700000120000})).data).not.toBeNull();
  });
  it('fresh generation lookup never returns the former generation',async()=>{
    const first=await claim();expect((await repo.findEtaGeneration(id)).data.eta_calculation_generation).toBe(first);
    const next=await claim();expect((await repo.findEtaGeneration(id)).data.eta_calculation_generation).toBe(next);
  });
  it('migration reapplication preserves committed ETA and generation',async()=>{
    const generation=await claim();await commit(generation);await pg.exec(migration);
    expect((await row()).eta).toBe('estimate');expect((await row()).eta_calculation_generation).toBe(generation);
  });
  for(const patch of [{etaText:''},{arrivalEpochMs:-1},{arrivalEpochMs:8640000000000001},{thresholdSeconds:-1},{thresholdSeconds:Infinity},{thresholdSeconds:NaN},{generation:null}]){
    it(`invalid protocol arguments ${JSON.stringify(patch)} cannot mutate ETA`,async()=>{
      expect((await commit(await claim(),patch)).data).toBeNull();expect((await row()).eta).toBeNull();
    });
  }
  it('driver and expected status mismatches cannot claim or commit',async()=>{
    const generation=await claim();expect((await repo.claimEtaGeneration(id,other,'in_transit')).data).toBeNull();
    expect((await repo.claimEtaGeneration(id,driver,'picked_up')).data).toBeNull();
    expect((await commit(generation,{driverId:other})).data).toBeNull();expect((await commit(generation,{expectedStatus:'picked_up'})).data).toBeNull();
  });
  it('anon and authenticated roles cannot execute either RPC',async()=>{
    for(const role of ['anon','authenticated']){
      await pg.exec(`SET ROLE ${role}`);expect((await repo.claimEtaGeneration(id,driver,'in_transit')).error.message).toMatch(/permission denied/);
      expect((await commit('00000000-0000-4000-8000-000000000004')).error.message).toMatch(/permission denied/);await pg.exec('RESET ROLE');
    }
  });
  it('invoker function preserves existing RLS and service role table privileges',async()=>{
    await pg.exec(`GRANT SELECT,UPDATE ON orders TO service_role;ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
      CREATE POLICY fixture_row ON orders TO service_role USING(driver_id='${other}'::uuid) WITH CHECK(driver_id='${other}'::uuid);SET ROLE service_role;`);
    expect(await claim()).toBeNull();await pg.exec('RESET ROLE');
    const functions=(await pg.query("SELECT prosecdef,proconfig FROM pg_proc WHERE proname IN ('claim_order_eta_generation','commit_order_eta_generation')")).rows;
    expect(functions).toHaveLength(2);for(const f of functions){expect(f.prosecdef).toBe(false);expect(f.proconfig.some(c=>c.startsWith('search_path='))).toBe(true);}
  });
  it('service role can claim and commit an allowed row',async()=>{
    await pg.exec('GRANT SELECT,UPDATE ON orders TO service_role;SET ROLE service_role;');
    expect((await commit(await claim())).data.eta).toBe('estimate');await pg.exec('RESET ROLE');
  });
  it('persist helper rejects a missing generation without direct SQL fallback',async()=>{
    expect(await persistAndBroadcastEta({orderRepository:repo,orderId:id,driverId:driver,currentStatus:'in_transit',etaText:'bad',arrivalEpochMs:1700000000000})).toBe(false);
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

describe('ETA compatibility helpers',()=>{
  it('pickup and delivery lifecycle legs remain distinct',()=>{
    const order={pickup_lat:1,pickup_lng:2,drop_lat:3,drop_lng:4};
    expect(resolveDestinationForOrder({...order,status:'truck_assigned'})).toEqual({lat:1,lng:2});expect(resolveDestinationForOrder({...order,status:'picked_up'})).toEqual({lat:3,lng:4});
  });
  it('display, movement and ETA threshold helpers preserve results',()=>{
    expect(formatEtaDisplay(new Date(NaN))).toBeNull();expect(formatEtaDisplay(new Date(0))).toBe('Arriving soon');
    expect(hasMeaningfulMovement(null,10,20)).toBe(true);expect(isMeaningfulEtaChange(1000,120999,120)).toBe(false);expect(isMeaningfulEtaChange(1000,121000,120)).toBe(true);
  });
});
