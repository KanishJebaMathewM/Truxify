import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
vi.mock('../../src/middleware/logger.js',()=>({default:{info:vi.fn(),warn:vi.fn(),error:vi.fn(),debug:vi.fn()}}));
vi.mock('../../src/middleware/auth.js',()=>({authenticate:(_req,_res,next)=>next()}));
vi.mock('../../src/middleware/requirePolicy.js',()=>({requirePolicy:()=> (_req,_res,next)=>next()}));
vi.mock('../../src/services/order/deadheadMatchingService.js',()=>({default:{}}));
const input={driverDestination:{lat:12,lng:77},truckSpecs:{max_weight_kg:10000},arrivalTime:'2026-10-01T12:00:00Z',availableLoads:[]};
const offers=[{id:'load',pickup_lat:12,pickup_lng:77,drop_lat:13,drop_lng:78,weight:'3 tonnes',payment_inr:1000}];
const response=data=>({ok:true,status:200,text:async()=>JSON.stringify(data)});
let ml, gate;
beforeEach(async()=>{
  vi.resetModules(); vi.stubEnv('ML_API_KEY','test-key');
  ml=await import('../../src/services/ml.js');
  gate=(await import('../../src/services/mlMatchingGateway.js')).mlMatchingGateway;
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.unstubAllEnvs();});

describe('actual ML matching outage integration',()=>{
  it('preserves healthy request authentication and recommendation shape',async()=>{
    const body={recommendations:[{load_id:'a'}],version:'v1'};
    const mock=vi.fn().mockResolvedValue(response(body));vi.stubGlobal('fetch',mock);
    expect(await ml.matchDeadhead(input)).toEqual(body);
    const [url,options]=mock.mock.calls[0];
    expect(url).toContain('/match/deadhead');
    expect(options.headers['X-API-Key']).toBe('test-key');
    expect(JSON.parse(options.body).driver_destination).toEqual(input.driverDestination);
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('opens after repeated real service failures and immediately returns deterministic fallback',async()=>{
    const mock=vi.fn().mockRejectedValue(Error('connection refused'));vi.stubGlobal('fetch',mock);
    for(let i=0;i<5;i++) {
      const rows=await ml.matchEnRouteLoads({currentLat:12,currentLng:77,offers});
      expect(rows[0]).toMatchObject({id:'load',ml_used:false,extra_earnings:100000});
    }
    const results=await Promise.all(Array.from({length:20},()=>ml.matchEnRouteLoads({currentLat:12,currentLng:77,offers})));
    expect(mock).toHaveBeenCalledTimes(5);
    expect(results.every(rows=>rows[0].ml_used===false)).toBe(true);
    expect(gate.snapshot().state).toBe('OPEN');
  });

  it('aborts slow headers at2500ms and falls back before the former10s timeout',async()=>{
    vi.useFakeTimers();let signal;
    vi.stubGlobal('fetch',vi.fn((_url,options)=>new Promise((_yes,no)=>{
      signal=options.signal;signal.addEventListener('abort',()=>no(Error('aborted')),{once:true});
    })));
    const pending=ml.matchEnRouteLoads({currentLat:12,currentLng:77,offers});
    await vi.advanceTimersByTimeAsync(2499);expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);expect((await pending)[0].ml_used).toBe(false);
    expect(signal.aborted).toBe(true);expect(gate.snapshot().inFlight).toBe(0);
  });

  it('includes body parsing in the same deadline',async()=>{
    vi.useFakeTimers();let signal;
    vi.stubGlobal('fetch',vi.fn(async(_url,options)=>{
      signal=options.signal;return{ok:true,status:200,text:()=>new Promise((_yes,no)=>signal.addEventListener('abort',()=>no(Error('body aborted')),{once:true}))};
    }));
    const pending=ml.matchEnRouteLoads({currentLat:12,currentLng:77,offers});
    await vi.advanceTimersByTimeAsync(2500);
    expect((await pending)[0].ml_used).toBe(false);expect(signal.aborted).toBe(true);
  });

  it('reports fallback provenance when a healthy ML response contains no matches',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response({recommendations:[]})));
    expect((await ml.matchEnRouteLoads({currentLat:12,currentLng:77,offers}))[0].ml_used).toBe(false);
    expect(gate.snapshot().failures).toBe(0);
  });

  it('retains ML provenance for nonempty healthy predictions',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response({recommendations:[{load_id:'load',match_score:0.8,estimated_earnings:500}]})));
    expect((await ml.matchEnRouteLoads({currentLat:12,currentLng:77,offers}))[0]).toMatchObject({ml_used:true,match_score:0.8});
  });

  it('malformed matching responses count as dependency failures and use fallback',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response({recommendations:'bad'})));
    expect((await ml.matchEnRouteLoads({currentLat:12,currentLng:77,offers}))[0].ml_used).toBe(false);
    expect(gate.snapshot().failures).toBe(1);
  });

  it('missing configuration does not consume dependency admission',async()=>{
    vi.stubEnv('ML_API_KEY','');const mock=vi.fn();vi.stubGlobal('fetch',mock);
    expect((await ml.matchEnRouteLoads({currentLat:12,currentLng:77,offers}))[0].ml_used).toBe(false);
    expect(mock).not.toHaveBeenCalled();expect(gate.snapshot()).toMatchObject({failures:0,inFlight:0});
  });

  it('direct deadhead route maps native dependency failure to503 using the actual service',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockRejectedValue(Error('connection refused')));
    const router=(await import('../../src/routes/deadheadRoutes.js')).default;
    const handler=router.stack.find(x=>x.route?.path==='/match/deadhead').route.stack.at(-1).handle;
    const res={status:vi.fn().mockReturnThis(),json:vi.fn()};
    await handler({body:{driver_destination:input.driverDestination,truck_specs:input.truckSpecs,arrival_time:input.arrivalTime,available_loads:[]}},res);
    expect(res.status).toHaveBeenCalledWith(503);expect(res.json).toHaveBeenCalledWith({error:'ML recommendation engine is temporarily unavailable.'});
  });
});
