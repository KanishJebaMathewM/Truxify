import assert from 'node:assert/strict';
import {test, after} from 'node:test';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import Redis from 'ioredis';
import {GpsStreamIngestionService,GPS_STREAM_GROUP} from '../../src/services/gps/gpsStreamIngestionService.js';
const directory=await mkdtemp(`${tmpdir()}/gps-ingestion-`);
const server=spawn(process.env.NATIVE_REDIS_SERVER || 'redis-server',
  ['--port','0','--unixsocket',`${directory}/r.sock`,'--save','','--appendonly','no']);
await new Promise((resolve,reject)=>{
  let output='';
  server.stdout.on('data',buffer=>{output+=buffer.toString();if(output.toLowerCase().includes('ready to accept connections'))resolve();});
  server.on('error',reject);server.on('exit',code=>reject(new Error(`Redis exited ${code}: ${output}`)));
});
const redis=new Redis(`${directory}/r.sock`,{retryStrategy:null,maxRetriesPerRequest:0});
await redis.ping();
after(async()=>{redis.disconnect();server.kill();await new Promise(resolve=>server.once('exit',resolve));await rm(directory,{recursive:true,force:true});});
let counter=0;
function service(options={}) {return new GpsStreamIngestionService({redisClient:redis,streamKey:`s${++counter}`,...options});}
const ping=(extra={})=>({tripId:'trip',driverId:'driver',lat:10,lng:20,timestamp:1000,...extra});
async function rows(instance) {return (await redis.xrange(instance.streamKey,'-','+')).map(([id,fields])=>({id,...Object.fromEntries(Array.from({length:fields.length/2},(_,i)=>[fields[2*i],fields[2*i+1]]))}));}
function fence(instance) {instance.geofenceEvaluator.registerGeofence({id:'pickup',lat:10,lng:20,radiusMeters:500});}

test('native NOPERM retains exact ENTER payload and restores it on retry',async()=>{
 const instance=service();fence(instance);await redis.call('ACL','SETUSER','default','-xadd');
 let failed;
 try {failed=await instance.ingestPing(ping());}finally{await redis.call('ACL','SETUSER','default','+xadd');}
 assert.equal(failed.success,false);assert.equal(failed.persisted,false);assert.equal(failed.streamId,null);
 assert.equal(failed.geofenceEvents[0].eventType,'GEOFENCE_ENTER');
 assert.throws(()=>instance.ingestPing(ping({timestamp:2000})),/not acknowledged/);
 assert.throws(()=>instance.clearTrip('trip'),/cannot be discarded/);
 const receipt=await instance.ingestPing(ping());assert.equal(receipt.success,true);
 const written=await rows(instance);assert.equal(written.length,1);assert.equal(written[0].id,receipt.streamId);
 assert.deepEqual(JSON.parse(written[0].geofenceEvents),failed.geofenceEvents);
 assert.deepEqual(receipt.geofenceEvents,failed.geofenceEvents);
});
test('native CLIENT PAUSE owns late XADD after caller deadline, prevents new observation and duplicate write',async()=>{
 const instance=service({acknowledgementTimeoutMs:10});fence(instance);
 await redis.call('CLIENT','PAUSE','100','WRITE');
 const first=instance.ingestPing(ping());const duplicate=instance.ingestPing(ping());
 const [a,b]=await Promise.all([first,duplicate]);
 assert.equal(a.success,false);assert.equal(a.deliveryReason,'acknowledgement_pending');assert.deepEqual(a,b);
 assert.throws(()=>instance.ingestPing(ping({timestamp:2000})),/not acknowledged/);
 assert.throws(()=>instance.clearTrip('trip'),/cannot be discarded/);
 await new Promise(resolve=>setTimeout(resolve,200));
 const acknowledged=await instance.ingestPing(ping());assert.equal(acknowledged.success,true);
 assert.equal((await rows(instance)).length,1);assert.deepEqual(acknowledged.geofenceEvents,a.geofenceEvents);
});
test('parallel native identical calls share one admitted payload',async()=>{
 const instance=service();fence(instance);
 const receipts=await Promise.all(Array.from({length:20},()=>instance.ingestPing(ping())));
 assert.equal(new Set(receipts.map(r=>r.streamId)).size,1);assert.equal((await rows(instance)).length,1);
});
test('caller mutation cannot change admitted native payload or later receipt',async()=>{
 const instance=service();fence(instance);const input=ping();
 const pending=instance.ingestPing(input);input.lat=80;input.tripId='changed';
 const result=await pending;result.smoothed.lat=70;result.geofenceEvents[0].geofenceName='changed';
 const replay=await instance.ingestPing(ping());assert.equal(replay.smoothed.lat,10);
 assert.equal(replay.geofenceEvents[0].geofenceName,'Geofence Perimeter');
 const written=await rows(instance);assert.equal(written[0].rawLat,'10');assert.equal(written[0].tripId,'trip');
 const filters=instance.kalmanFilters;filters.get('trip').lat=90;filters.clear();
 assert.equal(instance.kalmanFilters.get('trip').lat,10);
});
test('native acknowledged timeline rejects conflicting/stale data without extra writes',async()=>{
 const instance=service();await instance.ingestPing(ping());
 for(const input of [ping({lat:11}),ping({timestamp:999}),ping({driverId:'other'})]) assert.throws(()=>instance.ingestPing(input),/must advance/);
 assert.equal((await rows(instance)).length,1);
 const next=await instance.ingestPing(ping({timestamp:2000,lat:10.00001}));assert.equal(next.success,true);
 assert.equal((await rows(instance)).length,2);
});
test('numeric ID zero, timestamp epoch zero, heading/accuracy zero and stationary smoothed speed survive native payload',async()=>{
 const instance=service();const result=await instance.ingestPing(ping({tripId:0,driverId:0,timestamp:0,speed:99,heading:0,accuracy:0}));
 assert.equal(result.timestamp,'1970-01-01T00:00:00.000Z');const row=(await rows(instance))[0];
 assert.equal(row.tripId,'0');assert.equal(row.driverId,'0');assert.equal(row.timestamp,'0');
 assert.equal(row.speed,'0');assert.equal(row.heading,'0');assert.equal(row.accuracy,'0');
});
test('native group creation distinguishes created/existing/failure',async()=>{
 const instance=service();assert.deepEqual(await instance.initStreamGroup(),{success:true,created:true});
 assert.deepEqual(await instance.initStreamGroup(),{success:true,created:false});
 assert.equal((await redis.xinfo('GROUPS',instance.streamKey))[0][1],GPS_STREAM_GROUP);
 await redis.call('ACL','SETUSER','default','-xgroup');
 try {assert.deepEqual(await instance.initStreamGroup(),{success:false,reason:'redis_unavailable'});}finally{await redis.call('ACL','SETUSER','default','+xgroup');}
});
test('unavailable Redis retains pending receipt without fake success',async()=>{
 const instance=service({redisClient:null});fence(instance);const result=await instance.ingestPing(ping());
 assert.equal(result.success,false);assert.equal(result.deliveryReason,'redis_unavailable');assert.equal(result.geofenceEvents.length,1);
 assert.equal((await instance.ingestPing(ping())).geofenceEvents.length,1);
});
test('bounded completed trips have explicit cleanup; pending receipts cannot be evicted',async()=>{
 const instance=service({maxTrips:1});fence(instance);await instance.ingestPing(ping());
 assert.throws(()=>instance.ingestPing(ping({tripId:'next'})),/capacity/);
 assert.equal(instance.clearTrip('trip'),true);assert.equal(instance.clearTrip('trip'),false);
 const next=await instance.ingestPing(ping({tripId:'next'}));assert.equal(next.geofenceEvents.length,1);
});
test('collaborator failure fences local state without writing, requires explicit cleanup',()=>{
 const instance=service({geofenceEvaluator:{evaluateLocation(){throw new Error('fault');},clearTrip(){}}});
 assert.throws(()=>instance.ingestPing(ping()),/fault/);assert.throws(()=>instance.ingestPing(ping()),/clearTrip/);
 assert.equal(instance.clearTrip('trip'),true);
});
const invalid=[null,[],{},ping({tripId:null}),ping({tripId:''}),ping({tripId:' trip'}),ping({tripId:{}}),ping({tripId:-1}),
 ping({driverId:null}),ping({lat:NaN}),ping({lat:Infinity}),ping({lat:91}),ping({lng:-181}),ping({lng:'20'}),
 ping({timestamp:'invalid'}),ping({timestamp:NaN}),ping({timestamp:-1}),ping({timestamp:0.5}),ping({timestamp:8640000000000001}),
 ping({speed:Infinity}),ping({speed:-1}),ping({heading:361}),ping({heading:null}),ping({accuracy:-1}),ping({accuracy:Infinity})];
for(const [index,input] of invalid.entries()) test(`invalid observation ${index} has no local or native Redis side effect`,async()=>{
 const instance=service();assert.throws(()=>instance.ingestPing(input));assert.equal(instance.kalmanFilters.size,0);assert.equal(await redis.exists(instance.streamKey),0);
});
for(const [index,options] of [{maxTrips:0},{maxTrips:1.2},{maxTrips:Infinity},{maxStreamEntries:0},{maxStreamEntries:1e8},
 {acknowledgementTimeoutMs:0},{acknowledgementTimeoutMs:60001},{streamKey:''},{streamKey:{}},{geofenceEvaluator:{}}].entries()) {
 test(`invalid service policy ${index} rejects before resources`,()=>assert.throws(()=>service(options)));
}
test('native bounded stream retention uses approximate MAXLEN and cannot erase current acknowledgement',async()=>{
 const instance=service({maxStreamEntries:1,maxTrips:1});
 for(let i=0;i<220;i++) {const result=await instance.ingestPing(ping({timestamp:1000+i}));assert.equal(result.success,true);}
 const count=await redis.xlen(instance.streamKey);assert.ok(count>=1 && count<=100,`approximate length ${count}`);
});

test('omitted timestamp receipt exposes the exact owned ping for a later retry',async()=>{
 const instance=service();await redis.call('ACL','SETUSER','default','-xadd');
 let result;try {const input=ping();delete input.timestamp;result=await instance.ingestPing(input);}
 finally {await redis.call('ACL','SETUSER','default','+xadd');}
 assert.equal(result.success,false);assert.ok(Number.isSafeInteger(result.observation.timestamp));
 const retry=await instance.ingestPing(result.observation);assert.equal(retry.success,true);
 assert.deepEqual(retry.observation,result.observation);assert.equal((await rows(instance)).length,1);
});
test('native paused group command has bounded caller waiting and remains owned through its late acknowledgement',async()=>{
 const instance=service({acknowledgementTimeoutMs:10});
 await redis.call('CLIENT','PAUSE','100','ALL');
 const [first,second]=await Promise.all([instance.initStreamGroup(),instance.initStreamGroup()]);
 assert.deepEqual(first,{success:false,reason:'acknowledgement_pending'});assert.deepEqual(first,second);
 await new Promise(resolve=>setTimeout(resolve,200));
 assert.deepEqual(await instance.initStreamGroup(),{success:true,created:false});
});
for(const key of ['maxTrips','maxStreamEntries','acknowledgementTimeoutMs']) test(`explicit null ${key} is not an omitted policy`,()=>assert.throws(()=>service({[key]:null})));
