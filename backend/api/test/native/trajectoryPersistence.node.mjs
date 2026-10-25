import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { setImmediate as immediate } from 'node:timers/promises';
import { test } from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { BatchTrajectoryPersistence } from '../../src/services/gps/batchTrajectoryPersistence.js';
const point=(changes={})=>({tripId:'trip',driverId:'driver',lat:20,lng:70,speedMps:0,heading:0,roadName:'road',timestamp:0,...changes});
async function fixture(t,handler,options={}) {
 const requests=[]; const sockets=new Set();
 const server=http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;
  const record={method:req.method,path:req.url,body:JSON.parse(body),headers:req.headers};requests.push(record);handler(req,res,record,requests);});
 server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const client=createClient(`http://127.0.0.1:${server.address().port}`,'native-local-test-key',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const writer=new BatchTrajectoryPersistence({supabase:client,flushIntervalMs:60000,maxBatchSize:50,flushTimeoutMs:500,...options});
 t.after(async()=>{await writer.stop();await client.removeAllChannels();for(const socket of sockets)socket.destroy();const closed=once(server,'close');server.close();await closed;});
 return{writer,requests};
}
const accepted=res=>{res.statusCode=201;res.end();};
const rejected=(res,status=400)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({code:'23514',message:'controlled native insert rejection'}));};

test('native locked SDK inserts only acknowledged exact rows and preserves epoch zero',async(t)=>{
 const{writer,requests}=await fixture(t,(_req,res)=>accepted(res));writer.addPoint(point());
 assert.equal(writer.pendingBuffer[0].recorded_at,'1970-01-01T00:00:00.000Z');assert.equal(await writer.flush(),1);assert.equal(writer.pendingBuffer.length,0);
 assert.equal(requests.length,1);assert.equal(requests[0].method,'POST');assert.ok(requests[0].path.startsWith('/rest/v1/trip_gps_trajectories?'));
 assert.equal(requests[0].body[0].speed_mps,0);assert.equal(requests[0].body[0].heading,0);assert.equal(requests[0].body[0].recorded_at,'1970-01-01T00:00:00.000Z');
 assert.equal(requests[0].headers.apikey,'native-local-test-key');
 assert.deepEqual(await writer.stop(),{success:true,acknowledged:0,pending:0});
});
for(const status of [400,401,409,429,500,503])test(`native SDK HTTP${status} retains the exact rejected batch for explicit successful retry`,async(t)=>{
 let failing=true;const{writer,requests}=await fixture(t,(_req,res)=>failing?rejected(res,status):accepted(res));writer.addPoint(point());
 const before=writer.pendingBuffer;assert.equal(await writer.flush(),0);assert.deepEqual(writer.pendingBuffer,before);
 failing=false;assert.equal(await writer.flush(),1);assert.deepEqual(requests.map(req=>req.body),[before,before]);assert.equal(writer.pendingBuffer.length,0);
});
test('single native flight owns an admitted prefix through later point arrival and concurrent flush calls',async(t)=>{
 let release;let arrival;const started=new Promise(resolve=>{arrival=resolve;});
 const{writer,requests}=await fixture(t,(_req,res)=>{release=()=>accepted(res);arrival();});writer.addPoint(point());const first=writer.flush();await started;
 writer.addPoint(point({timestamp:1000}));const second=writer.flush();assert.equal(first,second);assert.equal(requests.length,1);assert.equal(writer.pendingBuffer.length,2);
 release();assert.equal(await first,1);assert.equal(await second,1);assert.equal(writer.pendingBuffer.length,1);assert.equal(writer.pendingBuffer[0].recorded_at,'1970-01-01T00:00:01.000Z');
 const next=writer.flush();while(requests.length<2)await immediate();release();assert.equal(await next,1);assert.equal(writer.pendingBuffer.length,0);
});
test('stop retains admitted request ownership, closes admission, and drains later queued rows before receipt',async(t)=>{
 let release;let arrival;const started=new Promise(resolve=>{arrival=resolve;});
 const{writer,requests}=await fixture(t,(_req,res)=>{release=()=>accepted(res);arrival();});writer.addPoint(point());const flight=writer.flush();await started;writer.addPoint(point({timestamp:1000}));
 const staleTick=writer.flushTimer._onTimeout;let settled=false;const stopped=writer.stop();const same=writer.stop();assert.equal(stopped,same);stopped.then(()=>{settled=true;});
 await immediate();assert.equal(settled,false);assert.throws(()=>writer.addPoint(point()));assert.throws(()=>writer.startAutoFlush());staleTick();assert.equal(requests.length,1);
 release();assert.equal(await flight,1);while(requests.length<2)await immediate();release();assert.deepEqual(await stopped,{success:true,acknowledged:2,pending:0});
 writer.startAutoFlush();staleTick();await immediate();assert.equal(requests.length,2);writer.addPoint(point({timestamp:2000}));
 const next=writer.flush();while(requests.length<3)await immediate();release();assert.equal(await next,1);
});
test('failed shutdown receipt reports retained rows and allows manual retry or explicit restart',async(t)=>{
 let failing=true;const{writer}=await fixture(t,(_req,res)=>failing?rejected(res):accepted(res));writer.addPoint(point());
 assert.deepEqual(await writer.stop(),{success:false,acknowledged:0,pending:1});assert.equal(writer.pendingBuffer.length,1);assert.throws(()=>writer.addPoint(point()));
 failing=false;assert.equal(await writer.flush(),1);writer.startAutoFlush();writer.addPoint(point({timestamp:1000}));assert.deepEqual(await writer.stop(),{success:true,acknowledged:1,pending:0});
});
test('native fetch deadline aborts actual SDK request and preserves unacknowledged rows',async(t)=>{
 let arrived;let disconnected;const started=new Promise(resolve=>{arrived=resolve;});const closed=new Promise(resolve=>{disconnected=resolve;});
 const{writer}=await fixture(t,(_req,res)=>{res.once('close',disconnected);arrived();},{flushTimeoutMs:80});writer.addPoint(point());const before=writer.pendingBuffer;
 const flushing=writer.flush();await started;assert.equal(await flushing,0);await closed;assert.deepEqual(writer.pendingBuffer,before);
 assert.deepEqual(await writer.stop(),{success:false,acknowledged:0,pending:1});
});
test('ambiguous native connection loss retains rows without claiming exactly-once',async(t)=>{
 let failing=true;const{writer,requests}=await fixture(t,(_req,res)=>{if(failing)res.destroy();else accepted(res);});writer.addPoint(point());
 assert.equal(await writer.flush(),0);assert.equal(writer.pendingBuffer.length,1);failing=false;assert.equal(await writer.flush(),1);
 assert.equal(requests.length,2);assert.deepEqual(requests[0].body,requests[1].body);
});
test('native threshold follow-up drains queued full batches without overlapping SDK requests',async(t)=>{
 const pending=[];let active=0;let maximum=0;
 const{writer,requests}=await fixture(t,(_req,res)=>{active++;maximum=Math.max(maximum,active);pending.push(()=>{active--;accepted(res);});},{maxBatchSize:2,maxPendingPoints:6});
 for(let index=0;index<6;index++)writer.addPoint(point({timestamp:index*1000}));
 while(requests.length<1)await immediate();assert.equal(writer.pendingBuffer.length,6);pending.shift()();
 while(requests.length<2)await immediate();pending.shift()();while(requests.length<3)await immediate();pending.shift()();
 while(writer.pendingBuffer.length)await immediate();assert.equal(maximum,1);assert.deepEqual(requests.map(req=>req.body.map(row=>row.recorded_at)),[['1970-01-01T00:00:00.000Z','1970-01-01T00:00:01.000Z'],['1970-01-01T00:00:02.000Z','1970-01-01T00:00:03.000Z'],['1970-01-01T00:00:04.000Z','1970-01-01T00:00:05.000Z']]);
});
test('capacity includes an admitted unacknowledged prefix and rejects overflow without eviction',async(t)=>{
 let release;const{writer,requests}=await fixture(t,(_req,res)=>{release=()=>accepted(res);},{maxBatchSize:2,maxPendingPoints:2});writer.addPoint(point());writer.addPoint(point({timestamp:1000}));
 while(requests.length<1)await immediate();const before=writer.pendingBuffer;assert.throws(()=>writer.addPoint(point({timestamp:2000})),/capacity/);assert.deepEqual(writer.pendingBuffer,before);
 const flight=writer.flush();release();assert.equal(await flight,2);writer.addPoint(point({timestamp:2000}));const next=writer.flush();while(requests.length<2)await immediate();release();assert.equal(await next,1);
});
test('input Date and returned buffer views cannot rewrite owned queued SDK row',async(t)=>{
 const{writer,requests}=await fixture(t,(_req,res)=>accepted(res));const date=new Date(1000);const input=point({timestamp:date});writer.addPoint(input);input.lat=NaN;date.setTime(2000);
 const view=writer.pendingBuffer;view[0].lat=NaN;view[0].recorded_at='changed';view.length=0;assert.equal(await writer.flush(),1);
 assert.equal(requests[0].body[0].lat,20);assert.equal(requests[0].body[0].recorded_at,'1970-01-01T00:00:01.000Z');
});
const badPoints=[null,[],{},point({tripId:''}),point({tripId:{}}),point({driverId:{}}),point({lat:NaN}),point({lat:91}),point({lng:181}),point({lng:'70'}),point({speedMps:Infinity}),point({speedMps:-1}),point({speedMps:10001}),point({heading:361}),point({heading:'0'}),point({roadName:{}}),point({roadName:'x'.repeat(513)}),point({timestamp:null}),point({timestamp:NaN}),point({timestamp:-1}),point({timestamp:1.5}),point({timestamp:8640000000000001}),point({timestamp:new Date(NaN)}),point({timestamp:'2026-02-30T00:00:00Z'}),point({timestamp:'2026-10-07'}),point({timestamp:'2026-10-07T00:00:00'}),point({timestamp:false})];
for(const[index,value]of badPoints.entries())test(`complete invalid point${index} is rejected without queue or HTTP mutation`,async(t)=>{
 const{writer,requests}=await fixture(t,(_req,res)=>accepted(res));writer.addPoint(point());const before=writer.pendingBuffer;assert.throws(()=>writer.addPoint(value));assert.deepEqual(writer.pendingBuffer,before);assert.equal(requests.length,0);
});
test('explicit UTC strings normalize fractional milliseconds and omitted timestamp records native arrival time',async(t)=>{
 const{writer}=await fixture(t,(_req,res)=>accepted(res));writer.addPoint(point({timestamp:'2026-10-07T01:02:03Z'}));writer.addPoint(point({timestamp:'2026-10-07T01:02:03.1Z'}));writer.addPoint(point({timestamp:undefined}));
 assert.equal(writer.pendingBuffer[0].recorded_at,'2026-10-07T01:02:03.000Z');assert.equal(writer.pendingBuffer[1].recorded_at,'2026-10-07T01:02:03.100Z');assert.ok(Number.isFinite(Date.parse(writer.pendingBuffer[2].recorded_at)));
});
for(const[index,options]of [{flushIntervalMs:0},{flushIntervalMs:1.5},{flushIntervalMs:'1'},{maxBatchSize:0},{maxBatchSize:1001},{maxPendingPoints:0},{maxPendingPoints:100001},{maxPendingPoints:1,maxBatchSize:2},{flushTimeoutMs:0},{flushTimeoutMs:60001},{supabase:{}},{supabase:false}].entries())test(`invalid configuration${index} cannot start writer resources`,()=>assert.throws(()=>new BatchTrajectoryPersistence(options)));
