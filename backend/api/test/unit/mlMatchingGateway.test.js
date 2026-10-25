import { describe, it, expect, vi, afterEach } from 'vitest';
import { createServer } from 'node:http';
import { MlMatchingGateway } from '../../src/services/mlMatchingGateway.js';
vi.mock('../../src/middleware/logger.js', () => ({default:{info:vi.fn()}}));
const deferred = () => { let resolve, reject; const promise = new Promise((yes,no) => {resolve=yes;reject=no;}); return {promise,resolve,reject}; };
afterEach(() => vi.useRealTimers());

describe('matching admission and recovery', () => {
  it('bounds live operations and rejects excess without queueing or counting failure', async () => {
    const gate = new MlMatchingGateway({maxInFlight:2});
    const a=deferred(), b=deferred(), excess=vi.fn();
    const first=gate.execute(() => a.promise), second=gate.execute(() => b.promise);
    await expect(gate.execute(excess)).rejects.toThrow('capacity');
    expect(excess).not.toHaveBeenCalled();
    expect(gate.snapshot()).toMatchObject({inFlight:2,failures:0});
    a.resolve('a'); b.resolve('b');
    expect(await Promise.all([first,second])).toEqual(['a','b']);
    expect(gate.snapshot().inFlight).toBe(0);
  });

  it('aborts timed-out work but retains admission until an abort-ignoring adapter settles', async () => {
    vi.useFakeTimers();
    const gate=new MlMatchingGateway({deadlineMs:50,maxInFlight:1,failureThreshold:1});
    const pending=deferred(); let signal;
    const result=gate.execute(s => {signal=s;return pending.promise;});
    const rejection=expect(result).rejects.toThrow('[ML]');
    await vi.advanceTimersByTimeAsync(50); await rejection;
    expect(signal.aborted).toBe(true);
    expect(gate.snapshot()).toMatchObject({inFlight:1,state:'OPEN'});
    pending.resolve('late'); await Promise.resolve(); await Promise.resolve();
    expect(gate.snapshot()).toMatchObject({inFlight:0,state:'OPEN'});
    expect(vi.getTimerCount()).toBe(0);
  });

  it('admits exactly one probe after cooldown under concurrent recovery demand', async () => {
    let now=0;
    const gate=new MlMatchingGateway({failureThreshold:1,cooldownMs:10,now:()=>now});
    await expect(gate.execute(() => Promise.reject(new Error('offline')))).rejects.toThrow('[ML]');
    const noCall=vi.fn(); await expect(gate.execute(noCall)).rejects.toThrow('open');
    expect(noCall).not.toHaveBeenCalled();
    now=10; const pending=deferred(), probe=vi.fn(() => pending.promise);
    const result=gate.execute(probe);
    const others=await Promise.allSettled(Array.from({length:25},()=>gate.execute(probe)));
    expect(others.every(x=>x.status==='rejected')).toBe(true);
    expect(probe).toHaveBeenCalledTimes(1);
    pending.resolve('recovered'); expect(await result).toBe('recovered');
    expect(gate.snapshot()).toMatchObject({state:'CLOSED',failures:0,probeInFlight:false,inFlight:0});
  });

  it('failed recovery restarts cooldown without allowing additional probes', async () => {
    let now=0;
    const gate=new MlMatchingGateway({failureThreshold:1,cooldownMs:10,now:()=>now});
    await expect(gate.execute(()=>{throw Error('down');})).rejects.toThrow('[ML]');
    now=10; await expect(gate.execute(()=>{throw Error('down');})).rejects.toThrow('[ML]');
    now=19; await expect(gate.execute(vi.fn())).rejects.toThrow('open');
    now=20; expect(await gate.execute(()=> 'ok')).toBe('ok');
  });

  it('a pre-outage success cannot close a newer open circuit', async () => {
    const gate=new MlMatchingGateway({failureThreshold:1});
    const old=deferred(); const first=gate.execute(()=>old.promise);
    await expect(gate.execute(()=>{throw Error('down');})).rejects.toThrow('[ML]');
    old.resolve('old'); await first;
    expect(gate.snapshot()).toMatchObject({state:'OPEN',failures:1});
  });

  it('a pre-outage failure cannot reopen a successfully recovered generation', async () => {
    let now=0; const gate=new MlMatchingGateway({failureThreshold:1,cooldownMs:10,now:()=>now});
    const old=deferred(); const first=gate.execute(()=>old.promise);
    const rejection=expect(first).rejects.toThrow('[ML]');
    await expect(gate.execute(()=>{throw Error('down');})).rejects.toThrow('[ML]');
    now=10; await gate.execute(()=> 'recovered');
    old.reject(Error('late failure')); await rejection;
    expect(gate.snapshot()).toMatchObject({state:'CLOSED',failures:0});
  });

  it('counts consecutive dependency failures and resets them on a healthy response', async () => {
    const gate=new MlMatchingGateway({failureThreshold:2});
    await expect(gate.execute(()=>{throw Error('bad');})).rejects.toThrow('[ML]');
    await gate.execute(()=> 'ok');
    await expect(gate.execute(()=>{throw Error('bad');})).rejects.toThrow('[ML]');
    expect(gate.snapshot()).toMatchObject({state:'CLOSED',failures:1});
    await expect(gate.execute(()=>{throw Error('bad');})).rejects.toThrow('[ML]');
    expect(gate.snapshot().state).toBe('OPEN');
  });

  it.each([0,-1,NaN,Infinity,1.5])('rejects invalid configured bounds %s', value => {
    expect(()=>new MlMatchingGateway({deadlineMs:value})).toThrow(TypeError);
  });

  it('cancels a real native-fetch response body that stalls after headers', async () => {
    const server=createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.write('{');});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    try {
      const gate=new MlMatchingGateway({deadlineMs:200,failureThreshold:1});
      let receivedHeaders=false;
      const call=gate.execute(async signal=>{
        const response=await fetch(`http://127.0.0.1:${server.address().port}`,{signal});
        receivedHeaders=true; return response.text();
      });
      await expect(call).rejects.toThrow('[ML]');
      expect(receivedHeaders).toBe(true);
      await new Promise(resolve=>setTimeout(resolve,20));
      expect(gate.snapshot()).toMatchObject({state:'OPEN',inFlight:0});
    } finally {
      server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));
    }
  });
});
