import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { mongoBulkWire } from './fixtures/mongoBulkWire.js';
// The ordinary API setup mocks MongoClient globally. These wire fixtures must
// exercise the real driver's native result/error construction in both runners.
vi.unmock('mongodb');
vi.mock('../../src/config/db.js', () => ({ mongoDb: null }));
vi.mock('../../src/middleware/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
let pipeline;
const records = () => [0, 1, 2].map(id => ({ id }));
const ids = () => pipeline.getBuffer().toArray().map(r => r.id);
const partial = (writeErrors, count = 3 - writeErrors.length, extras = {}) => ({
  name: 'MongoBulkWriteError', code: writeErrors[0]?.code, message: 'bulk failure', writeErrors,
  result: { ok: 1, insertedCount: count, insertedIds: Object.fromEntries([0, 1, 2].filter(i => !writeErrors.some(e => e.index === i)).map(i => [i, `id${i}`])), getWriteConcernError: () => undefined, ...extras },
});
const setupFailure = error => pipeline._test.setMongoDbOverride({ collection: () => ({ insertMany: () => Promise.reject(error) }) });
const enqueue = () => records().forEach(r => pipeline.enqueue(r));
beforeEach(async () => {
  vi.stubEnv('TELEMETRY_BATCH_SIZE', '100'); vi.stubEnv('TELEMETRY_BUFFER_MAX_SIZE', '4');
  vi.resetModules(); pipeline = (await import('../../src/sockets/telemetryBuffer.js')).default;
});
afterEach(() => { pipeline._test.reset(); vi.unstubAllEnvs(); });

describe('native Mongo7.4 unordered insert recovery', () => {
  it('native mixed validation/retryable errors drop only invalid records and retry only failed valid records', async () => {
    const wire = await mongoBulkWire([{ ok: 1, n: 1, writeErrors: [
      { index: 0, code: 121, errmsg: 'Document failed validation' }, { index: 1, code: 91, errmsg: 'ShutdownInProgress' },
    ] }]);
    try {
      pipeline._test.setMongoDbOverride(wire.client.db('fixture')); enqueue(); await pipeline.flush();
      expect(ids()).toEqual([1]); expect(pipeline.getMetrics()).toMatchObject({ eventsDropped: 1, eventsFlushed: 1, validationDropped: 1, overflowDropped: 0, retryCount: 1 });
      await pipeline.flush(); expect(wire.batches.map(b => b.docs.map(r => r.id))).toEqual([[0,1,2], [1]]);
      expect(wire.batches.every(b => b.ordered === false)).toBe(true);
      expect(pipeline.getMetrics().eventsFlushed).toBe(2); expect(ids()).toEqual([]);
    } finally { await wire.close(); }
  }, 5000);

  it('native validation-only response counts acknowledged successes without retrying them', async () => {
    const wire = await mongoBulkWire([{ ok: 1, n: 2, writeErrors: [{ index: 1, code: 121, errmsg: 'invalid' }] }]);
    try {
      pipeline._test.setMongoDbOverride(wire.client.db('fixture')); enqueue(); await pipeline.flush();
      expect(ids()).toEqual([]); expect(pipeline.getMetrics()).toMatchObject({ eventsFlushed: 2, eventsDropped: 1, validationDropped: 1, retryCount: 0 });
      await pipeline.flush(); expect(wire.batches).toHaveLength(1);
    } finally { await wire.close(); }
  }, 5000);

  it('native write-concern uncertainty retains non-validation records instead of assuming insertion', async () => {
    const wire = await mongoBulkWire([{ ok: 1, n: 2, writeErrors: [{ index: 0, code: 121, errmsg: 'invalid' }],
      writeConcernError: { code: 64, errmsg: 'waiting for replication timed out' } }]);
    try {
      pipeline._test.setMongoDbOverride(wire.client.db('fixture')); enqueue(); await pipeline.flush();
      expect(ids()).toEqual([1,2]); expect(pipeline.getMetrics()).toMatchObject({ eventsFlushed: 0, eventsDropped: 1, retryCount: 1 });
    } finally { await wire.close(); }
  }, 5000);

  it('native interrupted split-batch result conservatively retains uncertain records', async () => {
    const wire = await mongoBulkWire([{ ok: 1, n: 2 }, null], { maxBatchSize: 3 });
    try {
      pipeline._test.setMongoDbOverride(wire.client.db('fixture')); enqueue(); await pipeline.flush();
      expect(wire.batches.map(b => b.docs.map(r => r.id))).toEqual([[0,1], [2]]);
      expect(ids()).toEqual([0,1,2]); expect(pipeline.getMetrics()).toMatchObject({ eventsFlushed: 0, eventsDropped: 0, retryCount: 1 });
    } finally { await wire.close(); }
  }, 5000);
});

describe('actual pipeline partial metadata and concurrent arrival handling', () => {
  it('wrapper code or message alone cannot mark a whole batch permanently invalid', async () => {
    setupFailure({ name:'BulkWriteError', code:121, message:'Document failed validation' }); enqueue(); await pipeline.flush();
    expect(ids()).toEqual([0,1,2]); expect(pipeline.getMetrics().eventsDropped).toBe(0);
  });
  it('mixed retryable first code still accounts for later indexed validation failures', async () => {
    setupFailure(partial([{index:0,code:91},{index:1,code:121}])); enqueue(); await pipeline.flush();
    expect(ids()).toEqual([0]); expect(pipeline.getMetrics()).toMatchObject({eventsFlushed:1,eventsDropped:1,retryCount:1});
  });
  for(const [name,errors] of [
    ['out of range',[{index:3,code:121}]],['negative',[{index:-1,code:121}]],['fractional',[{index:0.5,code:121}]],
    ['conflicting duplicate',[{index:0,code:121},{index:0,code:91}]],['missing code',[{index:0}]],['null item',[null]],
  ]){
    it(`malformed ${name} metadata retains all records`,async()=>{
      const error={name:'MongoBulkWriteError',code:121,writeErrors:errors}; setupFailure(error);enqueue();await pipeline.flush();
      expect(ids()).toEqual([0,1,2]);expect(pipeline.getMetrics()).toMatchObject({eventsFlushed:0,eventsDropped:0,retryCount:1});
    });
  }
  it.each([
    ['missing result',null],['inconsistent count',{insertedCount:0}],['missing IDs',{insertedIds:{}}],
    ['invalid ID index',{insertedIds:{99:'x',2:'y'}}],['noncanonical ID index',{insertedIds:{'01':'x',2:'y'}}],
    ['failed index counted successful',{insertedIds:{0:'x',2:'y'}}],['unacknowledged',{ok:0}],
    ['concern error',{getWriteConcernError:()=>({code:64})}],['throwing getter',{getWriteConcernError:()=>{throw new Error('broken');}}],
  ])('ambiguous %s outcome does not claim successful inserts',async(name,result)=>{
    const error=partial([{index:0,code:121}]);error.result=result===null?null:{...error.result,...result};setupFailure(error);enqueue();await pipeline.flush();
    expect(pipeline.getMetrics().eventsFlushed).toBe(0);
    if(name==='throwing getter')expect(ids()).toEqual([0,1,2]);else expect(ids()).toEqual([1,2]);
  });
  it('all-transient failure keeps oldest-first records and increases backoff',async()=>{
    setupFailure(new Error('connection lost'));enqueue();await pipeline.flush();
    expect(ids()).toEqual([0,1,2]);expect(pipeline.getState().flushBackoffMs).toBe(2000);
    expect(pipeline.getMetrics()).toMatchObject({eventsFlushed:0,eventsDropped:0,retryCount:1});
  });
  it('transient indexed failures retain only failed records after complete acknowledgement',async()=>{
    setupFailure(partial([{index:1,code:91}]));enqueue();await pipeline.flush();
    expect(ids()).toEqual([1]);expect(pipeline.getMetrics()).toMatchObject({eventsFlushed:2,eventsDropped:0,retryCount:1});
  });
  it('retries precede concurrent arrivals and coalesced flush callers do not double-write',async()=>{
    let reject;const insertion=new Promise((_,no)=>{reject=no;});const insert=vi.fn(()=>insertion);
    pipeline._test.setMongoDbOverride({collection:()=>({insertMany:insert})});enqueue();const pending=pipeline.flush();expect(pipeline.flush()).toBe(pending);
    pipeline.enqueue({id:3});reject(partial([{index:0,code:121},{index:1,code:91}]));await pending;
    expect(ids()).toEqual([1,3]);expect(insert).toHaveBeenCalledTimes(1);
  });
  it('overflow drops oldest retry records and keeps concurrent arrivals within capacity',async()=>{
    let reject;const insertion=new Promise((_,no)=>{reject=no;});pipeline._test.setMongoDbOverride({collection:()=>({insertMany:()=>insertion})});
    enqueue();const pending=pipeline.flush();for(let id=3;id<6;id++)pipeline.enqueue({id});reject(new Error('outage'));await pending;
    expect(ids()).toEqual([2,3,4,5]);expect(pipeline.getMetrics()).toMatchObject({eventsDropped:2,overflowDropped:2,validationDropped:0,retryCount:1});
  });
  it('successful retry clears error/backoff and flush count reflects actual attempted subset',async()=>{
    setupFailure(partial([{index:0,code:121},{index:1,code:91}]));enqueue();await pipeline.flush();
    const insert=vi.fn().mockResolvedValue({});pipeline._test.setMongoDbOverride({collection:()=>({insertMany:insert})});await pipeline.flush();
    expect(insert.mock.calls[0][0]).toEqual([{id:1}]);expect(pipeline.getState().flushBackoffMs).toBe(1000);
    expect(pipeline.getMetrics()).toMatchObject({lastFlushError:null,eventsFlushed:2,eventsDropped:1});
  });
});
