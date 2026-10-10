import test from 'node:test';
import assert from 'node:assert/strict';
import { PlatooningCoordinatorService, PLATOON_STATUS, VEHICLE_ROLE,
  calculateOptimalGapFeet, calculateFuelSavingsPercent } from '../../src/services/platooningCoordinatorService.js';
import { createSession, disengage } from '../../src/controllers/platoonController.js';

const service = () => new PlatooningCoordinatorService({logger: {info() {}, warn() {}}});
const create = (s, leadTruckId = 'lead', followerTruckId = 'follower') =>
  s.createPlatoonSession({leadTruckId, followerTruckId});
const domain = status => error => error.status === status;

test('same-clock burst retains every independent session', () => {
  const s = service(); const now = Date.now; Date.now = () => 123456789;
  try {
    const sessions = Array.from({length: 256}, (_, i) => create(s, `lead-${i}`, `follow-${i}`));
    assert.equal(new Set(sessions.map(x => x.platoonId)).size, 256);
    for (const session of sessions) assert.equal(s.activeSessions.get(session.platoonId), session);
    assert.equal(s.activeSessions.size, 256);
  } finally { Date.now = now; }
});

for (const [lead, follower] of [[null,'b'],['a',undefined],[1,'b'],['a',{}],['','b'],['a','  '],['a','a'],[' a ','a']]) {
  test(`invalid identities ${JSON.stringify([lead,follower])} are atomic`, () => {
    const s = service(); const prior = create(s, 'old-a', 'old-b');
    assert.throws(() => s.createPlatoonSession({leadTruckId:lead,followerTruckId:follower}), domain(400));
    assert.deepEqual([...s.activeSessions.values()], [prior]);
    assert.doesNotThrow(() => create(s,'new-a','new-b'));
  });
}

for (const [lead, follower] of [['lead','third'],['third','lead'],['follower','third'],['third','follower']]) {
  test(`either-role conflict ${lead}/${follower} is atomic`, () => {
    const s = service(); const original = create(s); const snapshot = structuredClone(original);
    assert.throws(() => create(s,lead,follower), domain(409));
    assert.equal(s.activeSessions.size,1); assert.deepEqual(original,snapshot);
    assert.doesNotThrow(() => create(s,'third','fourth')); // rejected request did not reserve third
  });
}

test('canonical identity and membership are instance-local', () => {
  const a=service(), b=service(); const session=create(a,' lead ',' follower ');
  assert.deepEqual(session.members.map(x=>x.truckId),['lead','follower']);
  assert.throws(()=>create(a,' lead ','new'),domain(409));
  assert.doesNotThrow(()=>create(b));
});

for (const trigger of ['normal','brake','manual','timeout']) {
  test(`${trigger} termination releases original owners and fences stale callbacks`, () => {
    const s=service(); const old=create(s);
    s.processTelemetry(old.platoonId,{distanceCoveredMiles:20});
    if(trigger==='normal') s.disengagePlatoon(old.platoonId);
    else {
      if(trigger==='timeout') old.lastHeartbeat=Date.now()-4000;
      const result=s.evaluateSafetyAndDecouple(old.platoonId,{
        accelerationMps2:trigger==='brake'?-5:0,manualOverride:trigger==='manual'});
      assert.equal(result.action,'INSTANT_DISENGAGEMENT');
      assert.equal(result.safeSeparationInitiated,true);
    }
    const terminal=structuredClone(old);
    const newer=create(s,'follower','lead');
    for(let i=0;i<3;i++) {
      const result=s.evaluateSafetyAndDecouple(old.platoonId,{accelerationMps2:-9,manualOverride:true});
      assert.equal(result.status,terminal.status); assert.equal(result.action,'ALREADY_DISENGAGED');
      assert.equal(result.safeSeparationInitiated,false);
      assert.equal(s.disengagePlatoon(old.platoonId).status,terminal.status);
      s.processTelemetry(old.platoonId,{distanceCoveredMiles:100,currentSpeedMph:90});
      assert.deepEqual(old,terminal);
      assert.throws(()=>create(s,'lead','third'),domain(409));
    }
    s.disengagePlatoon(newer.platoonId);
    assert.doesNotThrow(()=>create(s));
  });
}

test('release uses original membership even if returned presentation members change',()=>{
  const s=service(); const old=create(s);
  old.members[0].truckId='display-edit'; old.members.pop();
  s.disengagePlatoon(old.platoonId);
  assert.doesNotThrow(()=>create(s));
});

test('terminal evaluation cannot return an engaged action without a new trigger',()=>{
  const s=service(); const old=create(s); s.disengagePlatoon(old.platoonId);
  assert.equal(s.evaluateSafetyAndDecouple(old.platoonId,{accelerationMps2:0}).action,'ALREADY_DISENGAGED');
});

for(const operation of ['processTelemetry','evaluateSafetyAndDecouple','disengagePlatoon']) {
  test(`${operation} retains missing-session 404`,()=>{
    assert.throws(()=>service()[operation]('missing',{}),domain(404));
  });
}

test('active gap/fuel/control and summary contract remains intact',async()=>{
  const s=service(); const session=create(s);
  assert.equal(session.status,PLATOON_STATUS.ACTIVE);
  assert.equal(session.members[0].role,VEHICLE_ROLE.LEAD);
  assert.equal(session.members[1].role,VEHICLE_ROLE.FOLLOWER);
  assert.equal(calculateOptimalGapFeet(0),50);
  assert.ok(calculateOptimalGapFeet(65,30,0.3)>calculateOptimalGapFeet(65));
  assert.ok(calculateFuelSavingsPercent(VEHICLE_ROLE.FOLLOWER,50)>calculateFuelSavingsPercent(VEHICLE_ROLE.LEAD,50));
  assert.equal(s.evaluateSafetyAndDecouple(session.platoonId,{accelerationMps2:0}).action,'CONTINUE_ENGAGED');
  s.processTelemetry(session.platoonId,{distanceCoveredMiles:20});
  const expected=Math.round(20/6.5*(session.members.reduce((a,m)=>a+m.fuelSavingsPct,0)/2)/100*100)/100;
  assert.equal(session.totalFuelSavedGallons,expected);
  assert.deepEqual(s.disengagePlatoon(session.platoonId).summary,{
    totalFuelSavedGallons:expected,totalFinancialSavings:Math.round(expected*4*100)/100,membersCount:2});
  assert.equal((await s.findPlatoonPartners({truckId:'a',highwayRoute:'test'})).length,2);
});

test('actual controller preserves HTTP409 conflicts and terminal summaries',async()=>{
  const response=()=>({statusCode:null,body:null,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}});
  const first=response(); await createSession({body:{leadTruckId:'http-lead',followerTruckId:'http-follow'}},first);
  assert.equal(first.statusCode,201);
  const conflict=response(); await createSession({body:{leadTruckId:'http-follow',followerTruckId:'http-third'}},conflict);
  assert.equal(conflict.statusCode,409); assert.equal(conflict.body.success,false);
  const done=response(); await disengage({params:{platoonId:first.body.data.platoonId}},done);
  assert.equal(done.statusCode,200); assert.equal(done.body.data.status,PLATOON_STATUS.DISENGAGED);
});

for(const seed of [7,23,71]) {
  test(`independent state-model interleavings seed${seed}`,()=>{
    const s=service(), owned=new Map(), records=[];
    let rng=seed; const next=()=>{rng=(Math.imul(rng,1664525)+1013904223)>>>0;return rng >>> 16;};
    for(let step=0;step<300;step++) {
      const action=next()%4;
      if(action===0||records.length===0) {
        const a=`v${next()%12}`,b=`v${next()%12}`;
        if(a===b||owned.has(a)||owned.has(b)) assert.throws(()=>create(s,a,b),domain(a===b?400:409));
        else {const session=create(s,a,b); records.push({session,a,b,status:PLATOON_STATUS.ACTIVE});owned.set(a,session.platoonId);owned.set(b,session.platoonId);}
      } else {
        const r=records[next()%records.length];
        if(action===3) {
          const before=structuredClone(r.session);s.processTelemetry(r.session.platoonId,{distanceCoveredMiles:1});
          if(r.status!==PLATOON_STATUS.ACTIVE) assert.deepEqual(r.session,before);
        } else {
          if(action===1) s.disengagePlatoon(r.session.platoonId);
          else {const result=s.evaluateSafetyAndDecouple(r.session.platoonId,{manualOverride:true});assert.notEqual(result.action,'CONTINUE_ENGAGED');}
          if(r.status===PLATOON_STATUS.ACTIVE) {r.status=action===1?PLATOON_STATUS.DISENGAGED:PLATOON_STATUS.EMERGENCY_SPLIT;owned.delete(r.a);owned.delete(r.b);}
        }
      }
      assert.equal(s.activeSessions.size,records.length);
      for(const r of records) {
        assert.equal(s.activeSessions.get(r.session.platoonId),r.session);assert.equal(r.session.status,r.status);
        if(r.status===PLATOON_STATUS.ACTIVE) {assert.equal(owned.get(r.a),r.session.platoonId);assert.equal(owned.get(r.b),r.session.platoonId);}
      }
    }
  });
}
