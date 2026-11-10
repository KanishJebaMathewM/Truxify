import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { CorridorService } from '../../src/services/routing/corridorService.js';
import { admitRoute, corridorEnvelope, MAX_ROUTE_RESPONSE_BYTES } from '../../src/services/routing/corridorObservation.js';
import { EARTH_RADIUS_METERS } from '../../src/services/gps/geofenceEvaluator.js';
import { ProfitabilityScorer } from '../../src/services/routing/profitabilityScorer.js';
const start=()=>({lat:20,lng:70}); const end=()=>({lat:21,lng:71});
const response=(changes={})=>({code:'Ok',routes:[{geometry:{type:'LineString',coordinates:[[70,20],[71,21]]},distance:12345.6,duration:123,...changes}]});
const send=(res,data)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
async function fixture(t,handler,options={}) {
 const requests=[]; const sockets=new Set();
 const server=http.createServer((req,res)=>{requests.push(req.url);handler(req,res,requests);});
 server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const service=new CorridorService({osrmBaseUrl:`http://127.0.0.1:${server.address().port}`,...options});
 t.after(async()=>{service.breaker.destroy();for(const socket of sockets)socket.destroy();const closed=once(server,'close');server.close();await closed;});
 return {service,requests};
}
function validBounds(box) {
 assert.ok(Object.values(box).every(Number.isFinite));
 assert.ok(box.minLat>=-90 && box.maxLat<=90 && box.minLat<=box.maxLat);
 assert.ok(box.minLng>=-180 && box.maxLng<=180 && box.minLng<=box.maxLng);
}
function fallback(result,reason='provider_unavailable') {
 assert.equal(result.routeObserved,false);assert.equal(result.routeSource,'straight_line');assert.equal(result.routeReason,reason);
 assert.equal(result.directDistanceKm,0);assert.deepEqual(result.routeLineStringGeoJson.coordinates,[[70,20],[71,21]]);validBounds(result.boundingBox);
}

test('native Route request admits typed geometry/metrics and retains epoch-independent generation provenance',async(t)=>{
 const {service,requests}=await fixture(t,(_req,res)=>send(res,response()));
 const actual=await service.generateCorridor(start(),end(),0);
 assert.equal(actual.bufferMeters,0);assert.equal(actual.directDistanceKm,12.35);assert.equal(actual.directDurationMinutes,2);
 assert.equal(actual.routeSource,'osrm');assert.equal(actual.routeObserved,true);assert.equal(actual.routeReason,'observed_route');
 assert.deepEqual(actual.boundingBox,{minLng:70,maxLng:71,minLat:20,maxLat:21});
 assert.equal(new Date(actual.generatedAt).toISOString(),actual.generatedAt);
 const url=new URL(requests[0],'http://local');assert.equal(url.pathname,'/route/v1/driving/70.000000,20.000000;71.000000,21.000000');
 assert.equal(url.searchParams.get('geometries'),'geojson');assert.equal(url.searchParams.get('overview'),'full');assert.equal(url.searchParams.get('alternatives'),'false');
});
test('native NoRoute retains unobserved owned fallback rather than trusting stray geometry',async(t)=>{
 const {service}=await fixture(t,(_req,res)=>send(res,{code:'NoRoute',routes:response({geometry:{type:'LineString',coordinates:[[200,100],[201,101]]}}).routes}));
 fallback(await service.generateCorridor(start(),end()),'no_route');assert.equal(service.breaker.failureCount,0);
});
const badPayloads=[null,[],{}, {code:'NoSegment'},response({geometry:null}),response({geometry:{type:'Polygon',coordinates:[[70,20],[71,21]]}}),response({geometry:{type:'LineString',coordinates:[]}}),response({geometry:{type:'LineString',coordinates:[[70,20]]}})];
for (const point of [null,[],[200,20],[70,100],['70',20],[70,20,0],[null,20]]) badPayloads.push(response({geometry:{type:'LineString',coordinates:[point,[71,21]]}}));
for(const key of ['distance','duration'])for(const value of [-1,'1',null,1e12+1])badPayloads.push(response({[key]:value}));
for(const [index,payload]of badPayloads.entries())test(`malformed native provider${index} counts within actual breaker before fallback publication`,async(t)=>{
 const {service}=await fixture(t,(_req,res)=>send(res,payload));
 fallback(await service.generateCorridor(start(),end()));assert.equal(service.breaker.failureCount,1);
});
for(const [index,point]of [null,[],{}, {lat:NaN,lng:70},{lat:91,lng:70},{lat:20,lng:181},{lat:'20',lng:70},{lat:20,lng:Infinity},{lat:true,lng:70}].entries())test(`invalid input${index} rejected without native request or breaker mutation`,async(t)=>{
 const {service,requests}=await fixture(t,(_req,res)=>send(res,response()));
 await assert.rejects(service.generateCorridor(point,end()));await assert.rejects(service.getRouteGeometry(start(),point));
 assert.equal(requests.length,0);assert.equal(service.breaker.failureCount,0);
});
for(const [index,radius]of [-1,NaN,Infinity,'0',false,Math.PI*EARTH_RADIUS_METERS+1].entries())test(`invalid buffer${index} rejects before any HTTP`,async(t)=>{
 const {service,requests}=await fixture(t,(_req,res)=>send(res,response()));await assert.rejects(service.generateCorridor(start(),end(),radius));assert.equal(requests.length,0);
});

test('native dateline and pole routes have bounded conservative global longitude',async(t)=>{
 let payload=response({geometry:{type:'LineString',coordinates:[[179.9,0],[-179.9,0]]}});
 const {service}=await fixture(t,(_req,res)=>send(res,payload));
 const dateline=await service.generateCorridor({lat:0,lng:179.9},{lat:0,lng:-179.9},0);validBounds(dateline.boundingBox);assert.equal(dateline.longitudeMode,'global');assert.equal(dateline.boundingBox.minLng,-180);assert.equal(dateline.boundingBox.maxLng,180);
 payload=response({geometry:{type:'LineString',coordinates:[[0,90],[1,90]]},distance:0,duration:0});
 const pole=await service.generateCorridor({lat:90,lng:0},{lat:90,lng:1});validBounds(pole.boundingBox);assert.equal(pole.longitudeMode,'global');assert.equal(pole.boundingBox.maxLat,90);
});
test('independent direct spherical-circle destinations fit conservative envelopes at every bearing',()=>{
 const centres=[[0,0],[60,70],[-60,-70],[89.9,179.9],[-89.9,-179.9],[20,179.99],[90,0],[-90,0]];
 for(const [lat,lng]of centres)for(const metres of [0,1,25000,500000,Math.PI*EARTH_RADIUS_METERS]) {
  const {boundingBox:box}=corridorEnvelope([[lng,lat],[lng,lat]],metres);validBounds(box);
  const phi=lat*Math.PI/180;const lambda=lng*Math.PI/180;const angle=metres/EARTH_RADIUS_METERS;
  for(let degrees=0;degrees<360;degrees+=5) {
   const bearing=degrees*Math.PI/180;
   const nextPhi=Math.asin(Math.max(-1,Math.min(1,Math.sin(phi)*Math.cos(angle)+Math.cos(phi)*Math.sin(angle)*Math.cos(bearing))));
   const nextLambda=lambda+Math.atan2(Math.sin(bearing)*Math.sin(angle)*Math.cos(phi),Math.cos(angle)-Math.sin(phi)*Math.sin(nextPhi));
   const latitude=nextPhi*180/Math.PI;const longitude=((nextLambda*180/Math.PI+540)%360)-180;
   assert.ok(latitude>=box.minLat-1e-6&&latitude<=box.maxLat+1e-6);
   assert.ok(longitude>=box.minLng-1e-6&&longitude<=box.maxLng+1e-6);
  }
 }
});
test('asynchronous caller mutation and post-publication edits cannot rewrite owned corridor observations',async(t)=>{
 let release;let arrived;const requested=new Promise(resolve=>{arrived=resolve;});
 const {service,requests}=await fixture(t,(_req,res)=>{arrived();release=()=>send(res,response());});
 const origin=start();const destination=end();const pending=service.generateCorridor(origin,destination,0);await requested;
 origin.lat=NaN;origin.lng=100;destination.lng=200;release();const actual=await pending;
 assert.deepEqual(actual.origin,start());assert.deepEqual(actual.destination,end());assert.match(requests[0],/70\.000000,20\.000000/);
 actual.origin.lat=89;actual.routeLineStringGeoJson.coordinates[0][0]=120;
 assert.ok(Number.isNaN(origin.lat));assert.equal(destination.lng,200);
});
test('five malformed native responses open correctly configured breaker; next request is not issued',async(t)=>{
 const {service,requests}=await fixture(t,(_req,res)=>send(res,response({distance:'bad'})));
 for(let index=0;index<6;index++)fallback(await service.generateCorridor(start(),end()));
 assert.equal(requests.length,5);assert.equal(service.breaker.resetTimeoutMs,20000);assert.equal(service.breaker.state,'OPEN');
});
test('native breaker cancellation closes the outstanding actual Axios request',async(t)=>{
 let closed;let arrived;const request=new Promise(resolve=>{arrived=resolve;});const disconnected=new Promise(resolve=>{closed=resolve;});
 const {service}=await fixture(t,(req,_res)=>{req.once('close',closed);arrived();},{timeoutMs:80});
 service.breaker.requestTimeoutMs=40;
 const pending=service.generateCorridor(start(),end());await request;fallback(await pending);await disconnected;
 assert.equal(service.breaker.timeoutCount,1);
});
test('native oversized response rejects within breaker rather than publishing partial geometry',async(t)=>{
 const {service}=await fixture(t,(_req,res)=>send(res,{...response(),extra:'x'.repeat(MAX_ROUTE_RESPONSE_BYTES)}));
 fallback(await service.generateCorridor(start(),end()));assert.equal(service.breaker.failureCount,1);
});
test('native HTTP failure and malformed JSON are unobserved provider failures',async(t)=>{
 let mode=0;const {service}=await fixture(t,(_req,res)=>{if(mode===0){res.statusCode=503;res.end('unavailable');}else{res.setHeader('Content-Type','application/json');res.end('{');}});
 fallback(await service.generateCorridor(start(),end()));mode=1;fallback(await service.generateCorridor(start(),end()));assert.equal(service.breaker.failureCount,2);
});
test('actual native profitability consumer accepts the owned observed corridor contract without provider bootstrap',async(t)=>{
 const {service}=await fixture(t,(_req,res)=>send(res,response({distance:200000})));
 const corridor=await service.generateCorridor(start(),end());
 const loads=new ProfitabilityScorer().scoreAndRankMatches(corridor,[{id:'test-load',pickup_lat:20,pickup_lng:70,drop_lat:21,drop_lng:71,price_paisa:500000}]);
 assert.equal(loads.length,1);assert.ok(Object.values(loads[0].financials).every(Number.isFinite));
});
test('direct protocol admission rejects sparse geometry and returns independently owned coordinate arrays',()=>{
 const data=response();const admitted=admitRoute(data);data.routes[0].geometry.coordinates[0][0]=180;assert.equal(admitted.coordinates[0][0],70);
 assert.throws(()=>admitRoute(response({geometry:{type:'LineString',coordinates:Array(2)}})));
 assert.throws(()=>admitRoute(response({geometry:{type:'LineString',coordinates:Array(20001).fill([0,0])}})));
});
for(const [index,config]of [{defaultBufferMeters:-1},{defaultBufferMeters:Infinity},{defaultBufferMeters:'0'},{defaultBufferMeters:false},{timeoutMs:0},{timeoutMs:1.5},{timeoutMs:60001},{osrmBaseUrl:''},{osrmBaseUrl:'file:///tmp/provider'},{osrmBaseUrl:'http://localhost/?token=a'}].entries())test(`invalid native configuration${index} is rejected`,()=>assert.throws(()=>new CorridorService(config)));
