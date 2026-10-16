import assert from 'node:assert/strict';import http from 'node:http';import{once}from'node:events';import{test}from'node:test';import{createClient}from'@supabase/supabase-js';
import{SpatialMatcher,SpatialQueryUnavailable}from'../../src/services/routing/spatialMatcher.js';import{DriverDispatchPipeline}from'../../src/services/routing/driverDispatchPipeline.js';
const box=()=>({minLng:70,maxLng:71,minLat:20,maxLat:21});
const row=(changes={})=>({id:'load',customer_id:'customer',pickup_address:'pickup',drop_address:'drop',pickup_lat:20,pickup_lng:70,drop_lat:21,drop_lng:71,weight_kg:500,price_paisa:500000,pickup_time_window_start:null,pickup_time_window_end:null,status:'PENDING',...changes});
const send=(res,data,status=200)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
async function fixture(t,handler,options={}){
 const requests=[];const sockets=new Set();
 const server=http.createServer((req,res)=>{requests.push(req.url);handler(req,res,requests);});server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});server.listen(0,'127.0.0.1');await once(server,'listening');
 const url=`http://127.0.0.1:${server.address().port}`;const client=createClient(url,'native-local-test-key',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const matcher=new SpatialMatcher({supabase:client,queryTimeoutMs:300,...options});
 t.after(async()=>{await client.removeAllChannels();for(const socket of sockets)socket.destroy();const closed=once(server,'close');server.close();await closed;});return{matcher,requests,client,url};
}
test('native SDK composes owned geographic predicates, zero weight and explicit epoch departure without invented ETA',async(t)=>{
 const{matcher,requests}=await fixture(t,(_req,res)=>send(res,[row({weight_kg:0})]));const actual=await matcher.findCorridorLoads({boundingBox:box()},{maxWeightKg:0,driverEarliestDeparture:0});assert.equal(actual.length,1);
 const query=new URL(requests[0],'http://local').searchParams;assert.equal(query.get('status'),'eq.PENDING');assert.deepEqual(query.getAll('pickup_lng'),['gte.70','lte.71']);assert.deepEqual(query.getAll('pickup_lat'),['gte.20','lte.21']);assert.equal(query.get('weight_kg'),'lte.0');assert.equal(query.get('limit'),'50');assert.equal(query.get('or'),'(pickup_time_window_end.is.null,pickup_time_window_end.gte.1970-01-01T00:00:00.000Z)');
 assert.equal(query.get('select').split(',').length,13);
});
test('only an observed native empty array becomes empty matches',async(t)=>{const{matcher}=await fixture(t,(_req,res)=>send(res,[]));assert.deepEqual(await matcher.findCorridorLoads({boundingBox:box()}),[]);});
for(const status of[400,401,403,404,429,500,503])test(`native SDK query${status} propagates typed unobserved status without false empty scan`,async(t)=>{
 const{matcher,requests}=await fixture(t,(_req,res)=>send(res,{code:'42P01',message:'controlled rejection'},status));await assert.rejects(matcher.findCorridorLoads({boundingBox:box()}),error=>error instanceof SpatialQueryUnavailable&&error.code==='SPATIAL_QUERY_UNOBSERVED'&&error.status===status);assert.equal(requests.length,1);
});
test('native GET abort signal closes unobserved request and returns typed failure',async(t)=>{
 let arrived;let closed;const arrival=new Promise(resolve=>{arrived=resolve;});const disconnected=new Promise(resolve=>{closed=resolve;});
 const{matcher}=await fixture(t,(_req,res)=>{res.once('close',closed);arrived();},{queryTimeoutMs:80});const pending=matcher.findCorridorLoads({boundingBox:box()});await arrival;await assert.rejects(pending,SpatialQueryUnavailable);await disconnected;
});
test('native malformed JSON and disconnected response are unknown rather than empty',async(t)=>{
 let mode=0;const{matcher}=await fixture(t,(_req,res)=>{if(mode===0){res.setHeader('Content-Type','application/json');res.end('{');}else res.destroy();});await assert.rejects(matcher.findCorridorLoads({boundingBox:box()}),SpatialQueryUnavailable);mode=1;await assert.rejects(matcher.findCorridorLoads({boundingBox:box()}),SpatialQueryUnavailable);
});
const badBoxes=[null,[],{}, {...box(),minLng:Infinity},{...box(),maxLng:NaN},{...box(),minLng:72},{...box(),maxLng:181},{...box(),minLng:-181},{...box(),minLat:22},{...box(),maxLat:91},{...box(),minLat:-91},{...box(),minLat:'20'},{...box(),maxLat:false}];
for(const[index,bounds]of badBoxes.entries())test(`complete invalid bounds${index} reject before native query`,async(t)=>{const{matcher,requests}=await fixture(t,(_req,res)=>send(res,[]));await assert.rejects(matcher.findCorridorLoads({boundingBox:bounds}));assert.equal(requests.length,0);});
for(const[index,filters]of[null,[],{maxWeightKg:-1},{maxWeightKg:NaN},{maxWeightKg:Infinity},{maxWeightKg:'0'},{maxWeightKg:false},{maxWeightKg:1e9+1},{driverEarliestDeparture:'bad'},{driverEarliestDeparture:null},{vehicleType:'truck'},{unknownConstraint:1}].entries())test(`complete invalid or unsupported filter${index} is not silently ignored`,async(t)=>{const{matcher,requests}=await fixture(t,(_req,res)=>send(res,[]));await assert.rejects(matcher.findCorridorLoads({boundingBox:box()},filters));assert.equal(requests.length,0);});
const malformed=[null,{},[null],[[]],[{}],Array(51).fill(row()),[row({status:'ACCEPTED'})],[row({id:null})],[row({pickup_lat:NaN})],[row({pickup_lng:72})],[row({drop_lat:100})],[row({weight_kg:-1})],[row({pickup_time_window_start:'bad'})],[row({pickup_time_window_end:'bad'})],[row({pickup_time_window_start:'2026-10-08T00:00:00Z',pickup_time_window_end:'2026-10-07T00:00:00Z'})]];
for(const[index,data]of malformed.entries())test(`complete malformed decoded result${index} never becomes successful qualification`,async(t)=>{const{matcher}=await fixture(t,(_req,res)=>send(res,data));await assert.rejects(matcher.findCorridorLoads({boundingBox:box()}),SpatialQueryUnavailable);});
test('provider row cannot contradict admitted weight or expired end-time predicates',async(t)=>{
 let data=[row({weight_kg:1})];const{matcher}=await fixture(t,(_req,res)=>send(res,data));await assert.rejects(matcher.findCorridorLoads({boundingBox:box()},{maxWeightKg:0}),SpatialQueryUnavailable);
 data=[row({pickup_time_window_end:'2026-10-07T00:00:00Z'})];await assert.rejects(matcher.findCorridorLoads({boundingBox:box()},{driverEarliestDeparture:'2026-10-08T00:00:00Z'}),SpatialQueryUnavailable);
});
test('earliest-departure expiry does not fabricate pickup ETA or reject waiting before a future window',async(t)=>{
 const data=[row({pickup_time_window_start:'2026-10-08T00:00:00Z',pickup_time_window_end:'2026-10-09T00:00:00Z'})];const{matcher}=await fixture(t,(_req,res)=>send(res,data));assert.equal((await matcher.findCorridorLoads({boundingBox:box()},{driverEarliestDeparture:'2026-10-07T00:00:00Z'})).length,1);
});
test('owned query values survive caller mutation while actual HTTP response is pending',async(t)=>{
 let release;let arrived;const arrival=new Promise(resolve=>{arrived=resolve;});const{matcher,requests}=await fixture(t,(_req,res)=>{release=()=>send(res,[row({weight_kg:0})]);arrived();});
 const bounds=box();const date=new Date(0);const filters={maxWeightKg:0,driverEarliestDeparture:date};const pending=matcher.findCorridorLoads({boundingBox:bounds},filters);await arrival;bounds.minLng=Infinity;filters.maxWeightKg=NaN;date.setTime(2000);release();const result=await pending;assert.equal(result.length,1);const query=new URL(requests[0],'http://local').searchParams;assert.equal(query.getAll('pickup_lng')[0],'gte.70');assert.match(query.get('or'),/1970-01-01T00:00:00.000Z/);
});
const timing=[
 [0,null,null,true], [undefined,null,null,false], ['bad',null,null,false],
 ['2026-10-07T00:00:00Z','2026-10-07T00:00:00Z','2026-10-08T00:00:00Z',true],
 ['2026-10-08T00:00:00Z','2026-10-07T00:00:00Z','2026-10-08T00:00:00Z',true],
 ['2026-10-06T23:59:59.999Z','2026-10-07T00:00:00Z',null,false],
 ['2026-10-08T00:00:00.001Z',null,'2026-10-08T00:00:00Z',false],
 ['2026-10-07T05:30:00+05:30','2026-10-07T00:00:00Z','2026-10-07T00:00:00Z',true],
 ['2026-10-07T00:00:00Z','bad','bad',false], ['2026-10-07T00:00:00Z','2026-10-08T00:00:00Z','2026-10-07T00:00:00Z',false],
 ['2026-02-30T00:00:00Z',null,null,false], ['2026-10-07T24:00:00Z',null,null,false], ['2026-10-07',null,null,false],
 [null,null,null,false], [false,null,null,false], [1.5,null,null,false], [new Date(NaN),null,null,false], [new Date(0),0,0,true],
];
for(const[index,values]of timing.entries())test(`independent explicit time-window boundary${index} never qualifies unknown metadata`,()=>{const matcher=new SpatialMatcher();assert.equal(matcher.isTimeWindowFeasible(...values.slice(0,3)),values[3]);});
test('actual native dispatcher propagates rejected lookup instead of success/no-matches notification',async(t)=>{
 const{client,url}=await fixture(t,(req,res)=>req.url.startsWith('/route/')?send(res,{code:'Ok',routes:[{geometry:{type:'LineString',coordinates:[[70,20],[71,21]]},distance:200000,duration:600}]}):send(res,{code:'42P01',message:'controlled rejection'},400));
 const pipeline=new DriverDispatchPipeline({supabase:client,osrmBaseUrl:url,queryTimeoutMs:300});t.after(()=>pipeline.corridorService.breaker.destroy());await assert.rejects(pipeline.findAndDispatchDeadheadLoads({driverId:'native-driver',origin:{lat:20,lng:70},destination:{lat:21,lng:71}}),SpatialQueryUnavailable);
});
test('actual native dispatcher retains healthy matching and dispatch-payload contract',async(t)=>{
 const{client,url}=await fixture(t,(req,res)=>req.url.startsWith('/route/')?send(res,{code:'Ok',routes:[{geometry:{type:'LineString',coordinates:[[70,20],[71,21]]},distance:200000,duration:600}]}):send(res,[row()]));
 const pipeline=new DriverDispatchPipeline({supabase:client,osrmBaseUrl:url,queryTimeoutMs:300});t.after(()=>pipeline.corridorService.breaker.destroy());const result=await pipeline.findAndDispatchDeadheadLoads({driverId:'native-driver',origin:{lat:20,lng:70},destination:{lat:21,lng:71}});assert.equal(result.success,true);assert.equal(result.matchesCount,1);assert.equal(result.dispatchPayload.data.loadId,'load');assert.ok(Number.isFinite(result.dispatchPayload.data.netPayoutInr));
});
for(const[index,options]of[{queryTimeoutMs:0},{queryTimeoutMs:1.5},{queryTimeoutMs:60001},{queryTimeoutMs:'1'},{supabase:false},{supabase:{}}].entries())test(`invalid query configuration${index} is rejected`,()=>assert.throws(()=>new SpatialMatcher(options)));

test('native decoded response cap rejects oversized extra metadata without claiming a raw streaming limit',async(t)=>{const{matcher}=await fixture(t,(_req,res)=>send(res,[row({extra:'x'.repeat(1024*1024)})]));await assert.rejects(matcher.findCorridorLoads({boundingBox:box()}),SpatialQueryUnavailable);});
test('selected primitive type corruption is not accepted as a pending candidate',async(t)=>{const{matcher}=await fixture(t,(_req,res)=>send(res,[row({price_paisa:true})]));await assert.rejects(matcher.findCorridorLoads({boundingBox:box()}),SpatialQueryUnavailable);});
