import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {beforeAll,beforeEach,afterAll,describe,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({db:null,send:null,single:null}));
vi.mock('../../src/config/db.js',()=>({get supabaseAdmin(){return state.db;},firebaseAdmin:{messaging:()=>({sendEachForMulticast:a=>state.send(a),send:a=>state.single(a)})},redisClient:null}));
vi.mock('../../src/middleware/logger.js',()=>({default:{info:vi.fn(),warn:vi.fn(),error:vi.fn(),debug:vi.fn()}}));
vi.mock('../../src/lib/otpHashing.js',()=>({hashOtp:vi.fn(),verifyOtpHash:vi.fn()}));
vi.mock('../../src/core/performanceMetrics.js',()=>({measureExecution:(_name,fn)=>fn()}));
import {sendFcmNotification,sendNotification,clearInvalidToken} from '../../src/services/notificationService.js';
const migration=readFileSync(new URL('../../../../supabase/migrations/20261003034625_fcm_lifecycle_snapshot.sql',import.meta.url),'utf8');
const user='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
const id=n=>`00000000-0000-4000-8001-${String(n).padStart(12,'0')}`;
const invalid={success:false,error:{code:'messaging/registration-token-not-registered'}};
const message={title:'Trip',body:'Update'};
let pg,client;
const success=tokens=>({responses:tokens.map((_,i)=>({success:true,messageId:'msg'+i}))});
const device=async(n=1)=> (await pg.query('SELECT * FROM user_devices WHERE id=$1',[id(n)])).rows[0];
const profile=async()=> (await pg.query('SELECT * FROM profiles WHERE id=$1',[user])).rows[0];
async function seed(n=1,token='old',owner=user){await pg.query("INSERT INTO user_devices(id,user_id,fcm_token,platform,device_id,is_active,last_seen) VALUES($1,$2,$3,'android','phone',true,'2020-01-01')",[id(n),owner,token]);}
async function rpc(outcomes,owner=user){return (await pg.query('SELECT public.apply_fcm_lifecycle_outcomes($1,$2) AS result',[owner,JSON.stringify(outcomes)])).rows[0].result;}
beforeAll(async()=>{
 pg=new PGlite();await pg.exec(`SET TIME ZONE 'UTC';CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE profiles(id uuid PRIMARY KEY,fcm_token text,fcm_token_updated_at timestamptz);
 CREATE TABLE user_devices(id uuid PRIMARY KEY,user_id uuid REFERENCES profiles(id),fcm_token text UNIQUE NOT NULL,platform text,device_id text,is_active boolean,deactivated_at timestamptz,last_seen timestamptz);`);
 await pg.exec(migration);
},30000);
beforeEach(async()=>{
 vi.restoreAllMocks();await pg.exec('RESET ROLE;ALTER TABLE user_devices DISABLE ROW LEVEL SECURITY;DROP POLICY IF EXISTS fixture_row ON user_devices;TRUNCATE user_devices,profiles;');
 await pg.query("INSERT INTO profiles VALUES($1,'old',null),($2,'foreign',null)",[user,other]);
 client={rpc:vi.fn(async(name,args)=>{expect(name).toBe('apply_fcm_lifecycle_outcomes');return {data:await rpc(args.p_outcomes,args.p_user_id),error:null};}),from(table){
  expect(['user_devices','profiles']).toContain(table);let columns='*',patch=null;const vals=[],where=[];
  const safe=k=>{if(!/^[a-z_]+$/.test(k))throw new Error('Unsafe fixture field');return k;};
  const q={select(c){columns=c;return q;},update(p){patch=p;return q;},eq(k,v){vals.push(v);where.push(safe(k)+'=$'+vals.length);return q;},in(k,v){vals.push(v);where.push(safe(k)+'=ANY($'+vals.length+')');return q;},async execute(){
   columns.split(',').forEach(c=>{if(c.trim()!=='*')safe(c.trim());});
   let sql='SELECT '+columns+' FROM '+table+' WHERE '+where.join(' AND ');
   if(patch){const sets=Object.entries(patch).map(([k,v])=>{vals.push(v);return safe(k)+'=$'+vals.length;});sql='UPDATE '+table+' SET '+sets.join(',')+' WHERE '+where.join(' AND ');}
   const result=await pg.query(sql,vals);return {data:result.rows,error:null};
  },then(yes,no){return q.execute().then(yes,no);},async maybeSingle(){return q.single();},async single(){const x=await q.execute();return {data:x.data[0],error:x.error};}};return q;
 }};state.db=client;state.send=async a=>success(a.tokens);state.single=async()=> 'single-message';
});
afterAll(async()=>{await pg.close();});

describe('actual notification entry points with PostgreSQL lifecycle outcomes',()=>{
 it('late invalid old token cannot deactivate refreshed device',async()=>{
  await seed();state.send=async()=>{await pg.exec("UPDATE user_devices SET fcm_token='new';UPDATE profiles SET fcm_token='new' WHERE fcm_token='old';");return {responses:[invalid]};};
  const result=await sendFcmNotification(user,message);expect((await device()).is_active).toBe(true);expect((await device()).fcm_token).toBe('new');expect(result.summary.deactivated).toBe(0);expect((await profile()).fcm_token).toBe('new');
 });
 it('late success cannot touch refreshed registration last_seen',async()=>{
  await seed();state.send=async a=>{await pg.exec("UPDATE user_devices SET fcm_token='new',last_seen='2021-01-01'");return success(a.tokens);};
  const result=await sendFcmNotification(user,message);expect(result.success).toBe(true);expect((await device()).last_seen.toISOString()).toBe('2021-01-01T00:00:00.000Z');
 });
 it('late invalid response cannot mutate changed row ownership',async()=>{
  await seed();state.send=async()=>{await pg.query('UPDATE user_devices SET user_id=$1',[other]);return {responses:[invalid]};};
  const result=await sendFcmNotification(user,message);expect((await device()).is_active).toBe(true);expect(result.summary.deactivated).toBe(0);
 });
 it('already inactive registration is neither touched nor counted deactivated',async()=>{
  await seed();state.send=async()=>{await pg.exec('UPDATE user_devices SET is_active=false');return {responses:[invalid]};};
  const result=await sendFcmNotification(user,message);expect(result.summary.deactivated).toBe(0);expect((await device()).deactivated_at).toBeNull();
 });
 it('partial results retire invalid device and touch valid sibling in one batch',async()=>{
  await seed();await seed(2,'valid');state.send=async()=>({responses:[invalid,{success:true,messageId:'valid'}]});
  const result=await sendFcmNotification(user,message);expect(result.summary).toMatchObject({delivered:1,permanent:1,deactivated:1});expect((await device()).is_active).toBe(false);expect((await device(2)).last_seen.getUTCFullYear()).toBeGreaterThan(2020);expect(client.rpc).toHaveBeenCalledTimes(1);expect((await profile()).fcm_token).toBeNull();
 });
 it.each(['messaging/unavailable','messaging/invalid-payload','unknown'])('nonpermanent %s response retains registration',async code=>{
  await seed();state.send=async()=>({responses:[{success:false,error:{code}}]});await sendFcmNotification(user,message);
  expect((await device()).is_active).toBe(true);expect(client.rpc).not.toHaveBeenCalled();
 });
 it('missing RPC does not execute ID-only fallback after delivery',async()=>{
  await seed();client.rpc.mockResolvedValue({data:null,error:{code:'PGRST202',message:'missing migration'}});state.send=async()=>({responses:[invalid]});
  const result=await sendFcmNotification(user,message);expect(result.summary.deactivated).toBe(0);expect((await device()).is_active).toBe(true);expect((await profile()).fcm_token).toBe('old');
 });
 it('thrown DB failure preserves successful provider result without lifecycle fallback',async()=>{
  await seed();client.rpc.mockRejectedValue(new Error('offline'));const result=await sendFcmNotification(user,message);
  expect(result.success).toBe(true);expect((await device()).last_seen.getUTCFullYear()).toBe(2020);
 });
 it('malformed lifecycle acknowledgement reports no unconfirmed deactivation',async()=>{
  await seed();client.rpc.mockResolvedValue({data:{deactivated:'1'},error:null});state.send=async()=>({responses:[invalid]});
  const result=await sendFcmNotification(user,message);expect(result.summary.deactivated).toBe(0);expect((await device()).is_active).toBe(true);
 });
 it('duplicate captured rows deduplicate sends and count actual DB row once',async()=>{
  await seed();const original=client.from.bind(client);client.from=table=>{const q=original(table);if(table==='user_devices'){const execute=q.execute;q.execute=async()=>{const x=await execute();return {...x,data:[...x.data,...x.data]};};}return q;};
  const sent=vi.fn(async()=>({responses:[invalid]}));state.send=sent;const result=await sendFcmNotification(user,message);
  expect(sent.mock.calls[0][0].tokens).toEqual(['old']);expect(result.summary.deactivated).toBe(1);
 });
 it('501 tokens remain two bounded provider and lifecycle batches',async()=>{
  await pg.query("INSERT INTO user_devices SELECT ('00000000-0000-4000-8001-'||lpad(i::text,12,'0'))::uuid,$1,'token-'||i,'android',null,true,null,'2020-01-01' FROM generate_series(1,501) i",[user]);
  const sent=vi.fn(async a=>success(a.tokens));state.send=sent;const result=await sendFcmNotification(user,message);
  expect(sent.mock.calls.map(c=>c[0].tokens.length)).toEqual([500,1]);expect(client.rpc).toHaveBeenCalledTimes(2);expect(result.summary.delivered).toBe(501);
 });
 it('invalid profile-only fallback clears only the sent token',async()=>{
  state.send=async()=>({responses:[invalid]});const result=await sendFcmNotification(user,message);expect(result.summary.deactivated).toBe(0);expect((await profile()).fcm_token).toBeNull();
 });
 it('rotated profile-only fallback survives the old rejection',async()=>{
  state.send=async()=>{await pg.query("UPDATE profiles SET fcm_token='new' WHERE id=$1",[user]);return {responses:[invalid]};};await sendFcmNotification(user,message);expect((await profile()).fcm_token).toBe('new');
 });
 it('legacy per-device sender also fences late invalid outcomes',async()=>{
  await seed();state.single=async()=>{await pg.exec("UPDATE user_devices SET fcm_token='new'");throw {code:'messaging/registration-token-not-registered'};};
  const result=await sendNotification(user,{notification:message});expect(result[0].success).toBe(false);expect((await device()).is_active).toBe(true);
 });
 it('explicit token cleanup does not clear a replacement profile token',async()=>{
  await pg.query("UPDATE profiles SET fcm_token='new' WHERE id=$1",[user]);expect(await clearInvalidToken(user,'old')).toBe(true);expect((await profile()).fcm_token).toBe('new');
 });
 it('no devices and no profile token skip provider/lifecycle work',async()=>{
  await pg.exec('UPDATE profiles SET fcm_token=null');const send=vi.fn();state.send=send;const result=await sendFcmNotification(user,message);expect(result.errorCode).toBe('NO_FCM_TOKEN');expect(send).not.toHaveBeenCalled();expect(client.rpc).not.toHaveBeenCalled();
 });
});

describe('real PostgreSQL predicate and privilege contract',()=>{
 it('one repeated invalid outcome is idempotent and counts actual mutations',async()=>{
  await seed();const outcomes=[{id:id(1),token:'old',outcome:'invalid'}];expect(await rpc(outcomes)).toEqual({deactivated:1,touched:0});expect(await rpc(outcomes)).toEqual({deactivated:0,touched:0});
 });
 it('conflicting outcomes retire rather than touch the invalid registration',async()=>{
  await seed();expect(await rpc([{id:id(1),token:'old',outcome:'success'},{id:id(1),token:'old',outcome:'invalid'}])).toEqual({deactivated:1,touched:0});expect((await device()).last_seen.getUTCFullYear()).toBe(2020);
 });
 it('success never moves a future last_seen backwards',async()=>{
  await seed();await pg.exec("UPDATE user_devices SET last_seen='2099-01-01'");await rpc([{id:id(1),token:'old',outcome:'success'}]);expect((await device()).last_seen.getUTCFullYear()).toBe(2099);
 });
 it.each([null,{},[{id:id(1),token:'old',outcome:'unknown'}],[{id:null,token:'old',outcome:'success'}],[{id:'invalid-uuid',token:'old',outcome:'invalid'}]])('malformed batch %j cannot partly mutate',async outcomes=>{
  await seed();await expect(rpc(outcomes)).rejects.toThrow();expect((await device()).is_active).toBe(true);
 });
 it('RPC executable only by existing service role; no definer or table privilege widening',async()=>{
  const x=(await pg.query("SELECT has_function_privilege('anon','public.apply_fcm_lifecycle_outcomes(uuid,jsonb)','EXECUTE') a,has_function_privilege('authenticated','public.apply_fcm_lifecycle_outcomes(uuid,jsonb)','EXECUTE') b,has_function_privilege('service_role','public.apply_fcm_lifecycle_outcomes(uuid,jsonb)','EXECUTE') c,p.prosecdef FROM pg_proc p WHERE p.proname='apply_fcm_lifecycle_outcomes'")).rows[0];expect(x).toEqual({a:false,b:false,c:true,prosecdef:false});
 });
 it('invoker preserves existing RLS predicates',async()=>{
  await seed();await pg.exec('GRANT USAGE ON SCHEMA public TO service_role;GRANT SELECT,UPDATE ON user_devices,profiles TO service_role;ALTER TABLE user_devices ENABLE ROW LEVEL SECURITY;CREATE POLICY fixture_row ON user_devices FOR ALL TO service_role USING(false) WITH CHECK(false);SET ROLE service_role;');
  expect(await rpc([{id:id(1),token:'old',outcome:'invalid'}])).toEqual({deactivated:0,touched:0});await pg.exec('RESET ROLE');expect((await device()).is_active).toBe(true);
 });
 it('profile mutation failure rolls back device deactivation in the same RPC',async()=>{
  await seed();await pg.exec(`CREATE FUNCTION public.reject_fixture_profile() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'fixture profile failure';END;$$;CREATE TRIGGER reject_fixture_profile BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION public.reject_fixture_profile();`);
  try {await expect(rpc([{id:id(1),token:'old',outcome:'invalid'}])).rejects.toThrow('fixture profile failure');expect((await device()).is_active).toBe(true);}
  finally{await pg.exec('DROP TRIGGER reject_fixture_profile ON profiles;DROP FUNCTION public.reject_fixture_profile();');}
 });
 it('migration reapplication preserves existing registrations',async()=>{
  await seed();await pg.exec(migration);expect((await device()).is_active).toBe(true);expect((await profile()).fcm_token).toBe('old');
 });
});
