import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ProfitabilityScorer } from '../../src/services/routing/profitabilityScorer.js';
import { roundDistanceChargePaisa } from '../../src/services/routing/profitabilityPolicy.js';
import { calculateHaversineDistanceMeters as distance } from '../../src/services/gps/geofenceEvaluator.js';

const oracle=JSON.parse(readFileSync(new URL('./profitabilityChargeOracle.json',import.meta.url)));
const corridor=()=>({origin:{lat:0,lng:0},destination:{lat:0,lng:0.01},directDistanceKm:distance(0,0,0,0.01)/1000});
const load=(changes={})=>({id:'load',customer_id:'customer',pickup_address:'pickup',drop_address:'drop',weight_kg:500,pickup_lat:0,pickup_lng:0,drop_lat:0,drop_lng:0.01,price_paisa:500000,...changes});
const finiteReceipt = item => {
  assert.ok(Object.values(item.financials).every(Number.isFinite));
  assert.ok(Object.values(item.detourMetrics).every(Number.isFinite));
  assert.ok(Number.isFinite(item.affinityScore) && item.affinityScore>=0 && item.affinityScore<=1);
  const f=item.financials;
  for (const key of ['offeredPayoutPaisa','extraFuelPaisa','extraTollPaisa','netIncrementalPayoutPaisa']) assert.ok(Number.isSafeInteger(f[key]) && f[key]>=0);
  assert.equal(f.netIncrementalPayoutPaisa+f.extraFuelPaisa+f.extraTollPaisa,f.offeredPayoutPaisa);
};

test('128 independently generated Python Fraction charge controls match exact native products',()=>{
  assert.match(oracle.provenance,/Fraction.from_float/);
  for (const row of oracle.cases) assert.equal(roundDistanceChargePaisa(row.distanceKm,row.ratePaisa).toString(),row.expectedPaisa);
});
test('real positive-distance half-paisa boundary is not inflated by intermediate floating multiplication',()=>{
  assert.equal(Math.round(0.00225*2000),5);
  assert.equal(roundDistanceChargePaisa(0.00225,2000),4n);
});
test('explicit zero payout yields no invented quote; positive zero-detour quote retains exact paisa',()=>{
  const scorer=new ProfitabilityScorer();
  assert.deepEqual(scorer.scoreAndRankMatches(corridor(),[load({price_paisa:0})]),[]);
  const receipt=scorer.scoreAndRankMatches(corridor(),[load({price_paisa:1})])[0];
  finiteReceipt(receipt); assert.equal(receipt.financials.offeredPayoutPaisa,1); assert.equal(receipt.financials.netIncrementalPayoutPaisa,1);
  assert.equal(receipt.affinityScore,1);
});
test('valid PostgreSQL decimal coordinate and integer quote strings are owned without coercing null/blank',()=>{
  const scorer=new ProfitabilityScorer();
  const item=load({price_paisa:'9007199254740991',pickup_lat:'0.0',pickup_lng:'0',drop_lat:'0',drop_lng:'1e-2',weight_kg:'500.5'});
  const receipt=scorer.scoreAndRankMatches(corridor(),[item])[0];
  finiteReceipt(receipt); assert.equal(receipt.weightKg,500.5); assert.equal(receipt.financials.offeredPayoutPaisa,Number.MAX_SAFE_INTEGER);
  item.pickup_address='changed'; receipt.pickupAddress='other';
  assert.equal(scorer.scoreAndRankMatches(corridor(),[load()])[0].pickupAddress,'pickup');
});

for (const [index,value] of [undefined,null,'',' ',NaN,Infinity,-1,1.5,true,false,'NaN','Infinity','-1','1.5','1e3','01','9007199254740992',Number.MAX_SAFE_INTEGER+1,{}].entries()) {
  test(`invalid quote${index} rejects whole batch before any ranking receipt`,()=>{
    const scorer=new ProfitabilityScorer();
    const previous=scorer.scoreAndRankMatches(corridor(),[load()]);
    assert.throws(()=>scorer.scoreAndRankMatches(corridor(),[load(),load({id:'bad',price_paisa:value})]));
    assert.deepEqual(scorer.scoreAndRankMatches(corridor(),[load()]),previous);
  });
}
const badLoads=[null,[],{},load({id:''}),load({id:{}}),load({customer_id:{}}),load({pickup_lat:NaN}),load({pickup_lat:91}),load({pickup_lng:181}),load({drop_lat:null}),load({drop_lng:''}),load({drop_lng:true}),load({weight_kg:-1}),load({weight_kg:Infinity}),load({pickup_address:{}}),load({drop_address:'x'.repeat(2049)})];
for (const [index,value] of badLoads.entries()) test(`invalid candidate${index} is not silently ranked`,()=>assert.throws(()=>new ProfitabilityScorer().scoreAndRankMatches(corridor(),[value])));
for (const [index,value] of [null,[],{}, {...corridor(),origin:null},{...corridor(),origin:{lat:NaN,lng:0}},{...corridor(),destination:{lat:0,lng:200}},{...corridor(),directDistanceKm:-1},{...corridor(),directDistanceKm:NaN},{...corridor(),directDistanceKm:Infinity},{...corridor(),directDistanceKm:'1'}].entries()) test(`invalid corridor${index} rejects before calculation`,()=>assert.throws(()=>new ProfitabilityScorer().scoreAndRankMatches(value,[load()])));

test('bounded complete batch rejects sparse holes and oversized admission',()=>{
  const scorer=new ProfitabilityScorer();
  assert.throws(()=>scorer.scoreAndRankMatches(corridor(),Array(2)));
  assert.throws(()=>scorer.scoreAndRankMatches(corridor(),Array(1001).fill(load())));
  assert.throws(()=>scorer.scoreAndRankMatches(corridor(),{}));
});
test('zero detour policy admits only zero incremental route and preserves zero fuel policy',()=>{
  const scorer=new ProfitabilityScorer({maxDetourRatio:0,fuelCostPerKmPaisa:0});
  assert.equal(scorer.maxDetourRatio,0); assert.equal(scorer.fuelCostPerKmPaisa,0);
  assert.equal(scorer.scoreAndRankMatches(corridor(),[load()]).length,1);
  assert.deepEqual(scorer.scoreAndRankMatches(corridor(),[load({pickup_lat:0.001,pickup_lng:0.005})]),[]);
  assert.throws(()=>{scorer.maxDetourRatio=1;},TypeError);
  assert.throws(()=>{scorer.fuelCostPerKmPaisa=NaN;},TypeError);
});
test('coincident corridor cannot report arbitrary off-corridor detour as zero percent',()=>{
  const coincident={origin:{lat:0,lng:0},destination:{lat:0,lng:0},directDistanceKm:0};
  const scorer=new ProfitabilityScorer();
  assert.deepEqual(scorer.scoreAndRankMatches(coincident,[load({price_paisa:100000000})]),[]);
  const receipt=scorer.scoreAndRankMatches(coincident,[load({drop_lng:0})])[0];
  finiteReceipt(receipt); assert.equal(receipt.detourMetrics.detourPercentage,0);
});
test('zero fuel cost is preserved while the declared toll proxy remains independently charged',()=>{
  const item=load({pickup_lat:0.0005,pickup_lng:0.005});
  const receipt=new ProfitabilityScorer({fuelCostPerKmPaisa:0}).scoreAndRankMatches(corridor(),[item])[0];
  finiteReceipt(receipt); assert.equal(receipt.financials.extraFuelPaisa,0); assert.ok(receipt.financials.extraTollPaisa>0);
});
test('genuinely unprofitable quote and enormous integer fee are excluded without unsafe publication',()=>{
  const item=load({pickup_lat:0.0005,pickup_lng:0.005,price_paisa:1});
  assert.deepEqual(new ProfitabilityScorer().scoreAndRankMatches(corridor(),[item]),[]);
  assert.deepEqual(new ProfitabilityScorer({fuelCostPerKmPaisa:Number.MAX_SAFE_INTEGER}).scoreAndRankMatches(corridor(),[load({pickup_lat:0.0005,pickup_lng:0.005})]),[]);
});
test('actual geometry ranking compares exact affinity before presentation rounding',()=>{
  const low=load({id:'low',pickup_lat:0.0005,pickup_lng:0.005,price_paisa:500000});
  const high={...low,id:'high',price_paisa:500001};
  const actual=new ProfitabilityScorer().scoreAndRankMatches(corridor(),[low,high]);
  assert.equal(actual.length,2); assert.equal(actual[0].affinityScore,actual[1].affinityScore);
  assert.deepEqual(actual.map(item=>item.loadId),['high','low']); actual.forEach(finiteReceipt);
  assert.deepEqual(new ProfitabilityScorer().scoreAndRankMatches(corridor(),[high,low]).map(item=>item.loadId),['high','low']);
});
test('genuine affinity ties preserve source order deterministically',()=>{
  const actual=new ProfitabilityScorer().scoreAndRankMatches(corridor(),[load({id:'b'}),load({id:'a'})]);
  assert.deepEqual(actual.map(item=>item.loadId),['b','a']);
});
test('native upstream antipodal geometry outcome is admitted consistently without a nonfinite record',()=>{
  const origin={lat:-78.69141861796379,lng:139.72028566058725}; const destination={lat:-origin.lat,lng:origin.lng-180};
  const candidate=load({pickup_lat:origin.lat,pickup_lng:origin.lng,drop_lat:destination.lat,drop_lng:destination.lng});
  const scorer=new ProfitabilityScorer();
  if (Number.isFinite(distance(origin.lat,origin.lng,destination.lat,destination.lng))) {
    const actual=scorer.scoreAndRankMatches({origin,destination},[candidate]);
    assert.equal(actual.length,1); finiteReceipt(actual[0]);
  } else {
    assert.throws(()=>scorer.scoreAndRankMatches({origin,destination},[candidate]),/computed direct distance/);
  }
});
for (const [index,config] of [{maxDetourRatio:-1},{maxDetourRatio:1.01},{maxDetourRatio:NaN},{maxDetourRatio:Infinity},{maxDetourRatio:'0'},{maxDetourRatio:false},{fuelCostPerKmPaisa:-1},{fuelCostPerKmPaisa:1.5},{fuelCostPerKmPaisa:Infinity},{fuelCostPerKmPaisa:NaN},{fuelCostPerKmPaisa:false},{fuelCostPerKmPaisa:Number.MAX_SAFE_INTEGER+1}].entries()) test(`invalid policy${index} cannot create an unadmitted scorer`,()=>assert.throws(()=>new ProfitabilityScorer(config)));
