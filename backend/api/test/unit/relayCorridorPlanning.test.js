import { test } from 'vitest';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import * as relay from '../../src/services/relayDispatchService.js';
import { planRelayRoute } from '../../src/controllers/relayController.js';
import { DomainError } from '../../src/services/order/domainError.js';
const { partitionRouteIntoCorridorLegs: plan, TRANSSHIPMENT_HUBS: hubs } = relay;
const radians = degrees => degrees * Math.PI / 180;
// Independent atan2(vector-cross, vector-dot) distance oracle, not service Haversine.
const xyz = p => [Math.cos(radians(p.lat))*Math.cos(radians(p.lng)), Math.cos(radians(p.lat))*Math.sin(radians(p.lng)), Math.sin(radians(p.lat))];
function distance(a, b) {
  const u=xyz(a), v=xyz(b);
  const cross=[u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
  return 6371*Math.atan2(Math.hypot(...cross), u.reduce((sum,x,i)=>sum+x*v[i],0));
}
function invariant(result, a, b, max) {
  assert.deepEqual(result.legs[0].origin,a);
  assert.deepEqual(result.legs.at(-1).destination,b);
  assert.ok(result.legs.length<=128);
  const hubIds=[];
  result.legs.forEach((leg,i)=>{
    assert.equal(leg.legIndex,i);
    assert.equal(leg.isFinalLeg,i===result.legs.length-1);
    const raw=distance(leg.origin,leg.destination);
    assert.ok(raw<=max+1e-7, `leg ${i}: ${raw} > ${max}`);
    assert.ok(Math.abs(leg.distanceKm-raw)<=0.0050001);
    if(result.isRelayApplicable) assert.ok(raw>1e-7);
    if(i) assert.deepEqual(leg.origin,result.legs[i-1].destination);
    for(const point of [leg.origin,leg.destination]) {assert.ok(Number.isFinite(point.lat));assert.ok(Number.isFinite(point.lng));assert.ok(Math.abs(point.lat)<=90);assert.ok(Math.abs(point.lng)<=180);}
    if(leg.hub) {hubIds.push(leg.hub.id);assert.equal(leg.destination.hubId,leg.hub.id);}
    if(result.isRelayApplicable) {
      const hash=crypto.createHash('sha256').update(`${leg.destination.lat},${leg.destination.lng},${i}`).digest('hex');
      assert.equal(leg.hubWaypointHash,hash);
    }
  });
  assert.equal(new Set(hubIds).size,hubIds.length);
}
test('Delhi-Bengaluru respects350km even when nearest hubs would overshoot',()=>invariant(plan(hubs[0],hubs[7],1000,{maxLegDistanceKm:350}),hubs[0],hubs[7],350));
test('Delhi-Gwalior100km does not repeat Agra or create a zero-length stop',()=>invariant(plan(hubs[0],hubs[2],1000,{maxLegDistanceKm:100}),hubs[0],hubs[2],100));
for(const [name,a,b,max] of [
  ['eastward dateline',{lat:0,lng:179},{lat:0,lng:-179},100],
  ['westward dateline',{lat:0,lng:-179},{lat:0,lng:179},100],
  ['high latitude',{lat:80,lng:-90},{lat:80,lng:90},300],
  ['polar endpoint',{lat:90,lng:10},{lat:65,lng:-130},300],
  ['near antipodal',{lat:0,lng:0},{lat:0.001,lng:179.999},350],
]) test(name+' follows the shortest great-circle arc',()=>{
  const result=plan(a,b,1000,{maxLegDistanceKm:max});invariant(result,a,b,max);
  assert.ok(result.legs.every(leg=>leg.hub===null));
  const raw=result.legs.reduce((sum,leg)=>sum+distance(leg.origin,leg.destination),0);
  assert.ok(Math.abs(raw-distance(a,b))<1e-5);
  if(name.includes('dateline')) assert.ok(result.legs.slice(0,-1).every(leg=>Math.abs(leg.destination.lng)>178));
  if(name==='high latitude') assert.ok(result.legs.some(leg=>leg.destination.lat>85));
});
test('short haul retains original direct response when it fits',()=>{
 const a={lat:0,lng:0,address:'A'},b={lat:0,lng:1,address:'B'};
 const p=plan(a,b,700); invariant(p,a,b,350);assert.equal(p.isRelayApplicable,false);assert.equal(p.legs[0].legAmount,700);assert.equal(p.legs.length,1);
});
test('short haul splits when an explicit smaller maximum requires it',()=>{
 const a={lat:0,lng:0},b={lat:0,lng:1};const p=plan(a,b,700,{maxLegDistanceKm:40});invariant(p,a,b,40);assert.equal(p.legs.length,3);
});
test('coincident endpoints retain a direct zero-distance result without division',()=>{
 const a={lat:2,lng:3};const p=plan(a,a,700);assert.equal(p.isRelayApplicable,false);assert.equal(p.legs[0].distanceKm,0);assert.equal(p.legs[0].legAmount,700);
});
test('feasible registered hub is selected, formula and inputs preserved',()=>{
 const a={...hubs[0]},b={...hubs[2]};const before=JSON.stringify([a,b,hubs]);
 const p=plan(a,b,1234.56,{maxLegDistanceKm:350});invariant(p,a,b,350);assert.ok(p.legs.some(l=>l.hub?.id==='HUB_AGR_01'));
 const total=p.legs.reduce((sum,l)=>sum+l.distanceKm,0);
 for(const l of p.legs) {assert.equal(l.legAmount,Number(((l.distanceKm/total)*1234.56).toFixed(2)));assert.equal(l.payoutSharePercentage,Number(((l.distanceKm/total)*100).toFixed(2)));}
 assert.equal(JSON.stringify([a,b,hubs]),before);
});
for(const max of [0,-1,NaN,Infinity,'100',false,null]) test(`invalid service distance ${String(max)} is400`,()=>assert.throws(()=>plan(hubs[0],hubs[7],1000,{maxLegDistanceKm:max}),e=>e instanceof DomainError&&e.status===400));
for(const [name,p] of [['missing',undefined],['string latitude',{lat:'2',lng:3}],['NaN',{lat:NaN,lng:3}],['infinite',{lat:2,lng:Infinity}],['latitude range',{lat:91,lng:3}],['longitude range',{lat:2,lng:-181}]]) test(`invalid coordinate ${name} is400`,()=>{
 assert.throws(()=>plan(p,hubs[0]),e=>e instanceof DomainError&&e.status===400);
 assert.throws(()=>plan(hubs[0],p),e=>e instanceof DomainError&&e.status===400);
});
test('ambiguous antipodal endpoints reject422',()=>assert.throws(()=>plan({lat:0,lng:0},{lat:0,lng:180}),e=>e instanceof DomainError&&e.status===422));
test('huge requested leg count rejects before allocation;128 remains supported',()=>{
 const a={lat:0,lng:0},b={lat:0,lng:90},d=distance(a,b);
 assert.throws(()=>plan(a,b,0,{maxLegDistanceKm:Number.MIN_VALUE}),e=>e instanceof DomainError&&e.status===422);
 assert.throws(()=>plan(a,b,0,{maxLegDistanceKm:d/129}),e=>e instanceof DomainError&&e.status===422);
 const p=plan(a,b,0,{maxLegDistanceKm:d/127.9});invariant(p,a,b,d/127.9);assert.equal(p.legs.length,128);
});
test('all720 ordered registered-hub/limit cases satisfy bounds and continuity',()=>{
 for(const a of hubs) for(const b of hubs) if(a!==b) for(const max of [100,200,350]) invariant(plan(a,b,1000,{maxLegDistanceKm:max}),a,b,max);
});
test('120 deterministic global property cases respect independent distances',()=>{
 let seed=41;const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/2**32;};
 for(let i=0;i<120;i++) {const a={lat:random()*178-89,lng:random()*360-180},b={lat:random()*178-89,lng:random()*360-180}; const max=300+random()*300;invariant(plan(a,b,1000,{maxLegDistanceKm:max}),a,b,max);}
});
async function controller(body) {
 let response;const res={statusCode:200,status(code){this.statusCode=code;return this;},json(value){response=value;return this;}};
 let error;await planRelayRoute({body},res,e=>{error=e;});assert.equal(error,undefined);return {status:res.statusCode,body:response};
}
test('actual controller returns a valid bounded dateline plan',async()=>{
 const origin={lat:0,lng:179},destination={lat:0,lng:-179};const r=await controller({origin,destination,maxLegDistanceKm:'100',totalAmount:1000});assert.equal(r.status,200);invariant(r.body.data,origin,destination,100);
});
for(const [name,patch,status] of [['zero',{maxLegDistanceKm:0},400],['negative',{maxLegDistanceKm:-1},400],['invalid',{maxLegDistanceKm:'oops'},400],['boolean',{maxLegDistanceKm:true},400],['budget',{maxLegDistanceKm:0.00001},422],['coordinate',{origin:{lat:91,lng:0}},400],['antipode',{destination:{lat:0,lng:180}},422]]) test(`controller maps ${name} to${status}`,async()=>{
 const r=await controller({origin:{lat:0,lng:0},destination:{lat:0,lng:3},...patch});assert.equal(r.status,status);assert.equal(r.body.success,false);assert.equal(typeof r.body.error,'string');
});
test('createRelaySession uses the corrected actual planner without dispatch or payment',async()=>{
 const session=await relay.createRelaySession('local-fixture',{origin:hubs[0],destination:hubs[7],totalAmount:1000,driverAssignments:[{driverId:'fixture-driver'}]});
 invariant({legs:session.legs,isRelayApplicable:true},hubs[0],hubs[7],350);assert.equal(session.legs[0].driverId,'fixture-driver');assert.equal(session.status,'ACTIVE');assert.equal(session.totalLegs,session.legs.length);
});

test('sub-resolution partition rejects rather than returning zero legs and NaN payouts',()=>{
 assert.throws(()=>plan({lat:0,lng:0},{lat:0,lng:0.00001},1000,{maxLegDistanceKm:0.0005}),e=>e instanceof DomainError&&e.status===422);
});
