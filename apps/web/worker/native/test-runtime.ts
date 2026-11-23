import { mkdir, readFile } from "node:fs/promises";
import { createHash, pbkdf2Sync } from "node:crypto";
import { build } from "esbuild";
import { Miniflare, Response as TestServiceResponse } from "miniflare";
import type { Request as TestRequest, Response as TestResponse } from "miniflare";
import { authenticate } from './auth';
import { importPack } from './application/content';
import { clearScopeSourcesCache } from './application/model';
import { Store } from './store';
import { admin, body, HttpError } from './types';
import {roomTestHooks} from './test-room-hooks';
import {soloTestHooks} from './test-solo-hooks';
import type { Env } from './types';
// @ts-expect-error Standalone Node migration module.
import { readNativeMigrations } from '../../scripts/native-migrations.mjs';
export const TEST_ORG="11111111-1111-4111-8111-111111111111";
export const TEST_USER="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
// Per-process caches: the esbuild bundle text is a pure function of which
// test hooks are enabled (hook callbacks themselves run in this process via
// the outbound service, never inside the bundle), the seed password hash has
// constant inputs, and the migration list is read from disk unchanged. Every
// createNativeTestApp call used to redo all three; with several hundred app
// creations per suite run that was a measurable slice of the total CPU.
const bundleCache = new Map<string, Promise<string>>();
let seedHashCache: string | undefined;
let migrationsCache: ReturnType<typeof readNativeMigrations> | undefined;
function seedPasswordHash(): string {
  if (!seedHashCache) {
    const salt = Buffer.alloc(16, 3);
    seedHashCache = `pbkdf2:${salt.toString("base64")}:${pbkdf2Sync("Testing!123", salt, 100000, 32, "sha256").toString("base64")}`;
  }
  return seedHashCache;
}
type TestDb = Awaited<ReturnType<Miniflare["getD1Database"]>>;
async function seedTestDatabase(db: TestDb): Promise<void> {
  const hash = seedPasswordHash();
  await db.prepare("INSERT INTO Organizations(id,name,slug) VALUES(?,?,?)").bind(TEST_ORG,"Practice Club","practice-club").run();
  await db.prepare("INSERT INTO Users(id,org_id,user_name,display_name,kind,role,password_hash,credential_version) VALUES(?,?,?,?,?,?,?,?)").bind(TEST_USER,TEST_ORG,"coach","Coach","Adult","Owner",hash,"v1").run();
}
/** Wipe every application table in the test database. The table list and the
 *  FK-safe delete order (children before the rows they reference) are derived
 *  from sqlite_master at call time — i.e. from the applied migrations — never
 *  from a hand-maintained list that could drift as the schema grows. Internal
 *  sqlite/_cf tables are Miniflare bookkeeping and are left alone. */
export async function wipeTestDatabase(db: TestDb): Promise<string[]> {
  const rows = (await db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table'").all<{ name: string; sql: string | null }>()).results ?? [];
  const tables = rows.filter(r => !r.name.startsWith("sqlite_") && !r.name.startsWith("_cf_"));
  const references = new Map(tables.map(t => [t.name, new Set([...(t.sql ?? "").matchAll(/REFERENCES\s+"?([A-Za-z_][\w]*)"?/gi)].map(m => m[1]))]));
  const remaining = new Map(tables.map(t => [t.name, references.get(t.name)!]));
  const order: string[] = [];
  while (remaining.size) {
    let progressed = false;
    for (const name of [...remaining.keys()]) {
      const referencedByRemaining = [...remaining].some(([other, refs]) => other !== name && refs.has(name));
      if (!referencedByRemaining) { order.push(name); remaining.delete(name); progressed = true; }
    }
    if (!progressed) { order.push(...remaining.keys()); remaining.clear(); }
  }
  if (order.length) await db.batch(order.map(name => db.prepare(`DELETE FROM "${name}"`)));
  if (rows.some(r => r.name === "sqlite_sequence")) await db.prepare("DELETE FROM sqlite_sequence").run();
  return order;
}
export async function createNativeTestApp(options:{d1Persist?:string;durableObjectsPersist?:string;measureD1?:boolean;onD1Meter?:(meter:{bindingCalls:number;statements:number;methods:Record<string,number>})=>void;beforeD1Statement?:(sql:string)=>Promise<void>;delayAuthentication?:boolean;replaceSoloAuthority?:boolean;soloTestClock?:boolean;replaceRoomAuthority?:boolean;roomTestClock?:boolean;roomStorageDiagnostics?:boolean;beforePasswordHash?:()=>Promise<void>;clearCachesOnReset?:boolean;bindings?:Record<string,string>;outboundService?:(request:TestRequest)=>Promise<TestResponse>}={}) {
  // Meter reports must also work in a fresh checkout without local artifacts.
  await mkdir(new URL("../../../../.local/", import.meta.url), { recursive: true });
  // Test-only compilation hook: exercise ingress ordering while authentication waits.
  // No delay header or equivalent bypass is included in the deployed bundle.
  const plugins=options.delayAuthentication||options.beforePasswordHash?[{name:"test-auth-delay",setup(builder:import("esbuild").PluginBuild){builder.onLoad({filter:/native[/\\]auth\.ts$/},async args=>{
    let source=await readFile(args.path,"utf8");
    if(options.delayAuthentication){
      const signature='export async function authenticate(request:Request,env:Env,practiceOrgId?:string):Promise<Actor> {';
      if(source.split(signature).length!==2)throw new Error("Authentication delay hook no longer matches the shared lookup.");
      source=source.replace(signature,`${signature} if(request.headers.has("x-test-auth-delay")) await new Promise(resolve=>setTimeout(resolve,1500));`);
    }
    if(options.beforePasswordHash){
      const signature='export async function hashUserPassword(env: Env, organizationId: string, userId: string, password: string): Promise<string> {';
      if(source.split(signature).length!==2)throw new Error("Password concurrency hook no longer matches the shared helper.");
      source=source.replace(signature,`${signature} await fetch("https://native-test.invalid/before-password-hash",{method:"POST"});`);
    }
    return {loader:"ts",contents:source};
  });}}]:[];
  if(options.measureD1||options.beforeD1Statement||options.onD1Meter||options.clearCachesOnReset)plugins.push({name:"test-d1-meter",setup(builder:import("esbuild").PluginBuild){builder.onLoad({filter:/native[/\\]index\.ts$/},async args=>{
    let source=await readFile(args.path,"utf8");
    if(options.clearCachesOnReset){
      // Shared-app resets must also drop per-isolate caches (the scope-sources
      // cache keys on org:season + revisions, which restart after a wipe, so
      // a stale entry could otherwise serve a previous test's sources).
      const ingress='async fetch(request:Request,env:Env):Promise<Response> {\n    try {';
      if(source.split(ingress).length!==2)throw new Error("Cache-clear hook no longer matches the HTTP entry point.");
      source='import {clearScopeSourcesCache} from "./application/model";\n'+source.replace(ingress,`${ingress} if(request.headers.has("x-test-clear-caches"))clearScopeSourcesCache();`);
    }
    if(!(options.measureD1||options.beforeD1Statement||options.onD1Meter))return {loader:"ts",contents:source};
    const signature='export default {';
    if(source.split(signature).length!==2)throw new Error("D1 meter hook no longer matches the HTTP entry point.");
    const before=options.beforeD1Statement?'async sql => { await fetch("https://native-test.invalid/d1-statement", {method:"POST",body:sql}); }':'undefined';
    const report=options.onD1Meter?'async meter => { await fetch("https://native-test.invalid/d1-meter", {method:"POST",body:JSON.stringify(meter)}); }':'undefined';
    const hook=','+before+','+report;
    return {loader:"ts",contents:source.replace(signature,'const unmeteredApp = {')+'\nimport {measureD1Fetch} from "./test-d1-meter";\nexport default {...unmeteredApp,fetch:measureD1Fetch(unmeteredApp.fetch'+hook+')};'};
  });}});
  if(options.measureD1||options.onD1Meter||options.replaceRoomAuthority||options.roomTestClock||options.roomStorageDiagnostics)plugins.push({name:"test-do-d1-meter",setup(builder:import("esbuild").PluginBuild){builder.onLoad({filter:/native[/\\]practice[/\\](room|reports)\.ts$/},async args=>{
    let source=await readFile(args.path,"utf8");
    source='import {measureD1Fetch,meteredObjectEnv,objectDatabase} from "../test-d1-meter";\n'+source;
    const report=options.onD1Meter?'async meter => { await fetch("https://native-test.invalid/d1-meter", {method:"POST",body:JSON.stringify(meter)}); }':'undefined';
    const before=options.beforeD1Statement?'async sql => { await fetch("https://native-test.invalid/d1-statement", {method:"POST",body:sql}); }':'undefined';
    if(source.includes('constructor(ctx:DurableObjectState,env:Env)'))source=source.replace('super(ctx,env);','super(ctx,meteredObjectEnv(env));');
    else source=source.replace('private tail:', 'constructor(ctx:DurableObjectState,env:Env){super(ctx,meteredObjectEnv(env));} private tail:');
    if(args.path.endsWith('room.ts'))source=roomTestHooks(source,{clock:options.roomTestClock,replace:options.replaceRoomAuthority,diagnostics:options.roomStorageDiagnostics});
    source=source.replace('async fetch(request:Request):Promise<Response>{',`async fetch(request:Request):Promise<Response>{return measureD1Fetch((req,env)=>objectDatabase.run(env.DB,()=>this.unmeteredFetch(req)),${before},${report})(request,this.env);} async unmeteredFetch(request:Request):Promise<Response>{`);
    return {loader:"ts",contents:source};
  });}});
  if(options.replaceSoloAuthority||options.soloTestClock)plugins.push({name:"test-solo-replacement",setup(builder:import("esbuild").PluginBuild){builder.onLoad({filter:/native[/\\]pbe[/\\]solo-round\.ts$/},async args=>{
    let source=await readFile(args.path,"utf8");
    if(options.replaceSoloAuthority){
      const signature="      const url=new URL(request.url),expected=url.searchParams.get('questionId'),input=request.method==='POST'?await body<Input>(request,32768):null,ingress=Date.now();";
      if(source.split(signature).length!==2)throw new Error("Solo replacement hook no longer matches the authority ingress.");
      const replacement=`${signature}\n      if(request.headers.has('x-test-authority-replaced')){const replaced=this.load();if(replaced){replaced.epoch='test-replaced-authority';this.save(replaced);await this.ctx.storage.setAlarm(Date.now());}return json({status:'replacement-scheduled'});}`;
      source=source.replace(signature,replacement);
    }
    if(options.soloTestClock)source=soloTestHooks(source,{clock:true});
    return {loader:"ts",contents:source};
  });}});
  const bundleKey=JSON.stringify([!!options.delayAuthentication,!!options.beforePasswordHash,!!options.measureD1,!!options.beforeD1Statement,!!options.onD1Meter,!!options.replaceRoomAuthority,!!options.roomTestClock,!!options.roomStorageDiagnostics,!!options.replaceSoloAuthority,!!options.soloTestClock,!!options.clearCachesOnReset]);
  let bundlePromise=bundleCache.get(bundleKey);
  if(!bundlePromise){
    bundlePromise=build({entryPoints:[new URL("./index.ts",import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,"$1")],bundle:true,write:false,format:"esm",platform:"neutral",target:"es2022",external:["cloudflare:workers","node:async_hooks"],plugins}).then(bundle=>bundle.outputFiles[0].text);
    bundleCache.set(bundleKey,bundlePromise);
  }
  const script=await bundlePromise;
  const outboundService=options.beforePasswordHash||options.beforeD1Statement||options.onD1Meter?async(request:TestRequest)=>{
    if(request.url==="https://native-test.invalid/d1-meter"&&options.onD1Meter){options.onD1Meter(await request.json() as Parameters<NonNullable<typeof options.onD1Meter>>[0]);return new TestServiceResponse(null,{status:204});}
    if(request.url==="https://native-test.invalid/d1-statement"&&options.beforeD1Statement){await options.beforeD1Statement(await request.text());return new TestServiceResponse(null,{status:204});}
    if(request.url==="https://native-test.invalid/before-password-hash") {await options.beforePasswordHash!();return new TestServiceResponse(null,{status:204});}
    if(options.outboundService)return options.outboundService(request);
    throw new Error("Unexpected network request in native concurrency test");
  }:options.outboundService;
  const runtimeOptions:ConstructorParameters<typeof Miniflare>[0]={modules:true,script,compatibilityDate:"2026-05-22",compatibilityFlags:["nodejs_compat"],d1Databases:{DB:"test-native"},d1Persist:options.d1Persist,durableObjectsPersist:options.durableObjectsPersist,durableObjects:{ROOMS:{className:"PracticeRoom",useSQLite:true},REPORTS:{className:"PracticeReports",useSQLite:true},PASSWORD_CRYPTO:{className:"PasswordCrypto",useSQLite:true},PBE_SOLO:{className:"PbeSoloRound",useSQLite:true}},bindings:{PUBLIC_ORIGIN:"https://erudoza.test",...options.bindings},outboundService};
  const runtime=new Miniflare(runtimeOptions);
  let db=await runtime.getD1Database("DB");
  const restart=async()=>{await runtime.setOptions({...runtimeOptions,bindings:{...runtimeOptions.bindings,FIXTURE_RESTART:crypto.randomUUID()}});db=await runtime.getD1Database("DB");};
  migrationsCache??=readNativeMigrations();
  for(const migration of await migrationsCache) await db.batch(migration.statements.map((sql:string)=>db.prepare(sql)));
  await seedTestDatabase(db);
  const fetch=(path:string,init:RequestInit={})=>runtime.dispatchFetch(`https://erudoza.test${path}`,init);
  const login=()=>fetch("/api/v1/auth/login",{method:"POST",headers:{Origin:"https://erudoza.test","Content-Type":"application/json"},body:JSON.stringify({identifier:"coach",password:"Testing!123"})});
  // Explicit test fixture adapter for archived imports. No route or bypass is deployed.
  const importFixture=async(input:unknown,cookie:string,org=TEST_ORG)=>{
    const env={DB:db} as unknown as Env;
    const request=new Request('https://erudoza.test/fixture',{method:'POST',headers:{Cookie:cookie},body:typeof input==='string'?input:JSON.stringify(input)});
    try {
      const actor=await authenticate(request,env);admin(actor);
      if(actor.organizationId!==org)throw new HttpError(403,'Organization access denied.');
      return Response.json(await importPack({request,env,actor,path:'/fixture',orgId:org,store:new Store(env.DB)},await body(request,2*1024*1024)));
    }catch(error){return Response.json({message:error instanceof Error?error.message:String(error)},{status:error instanceof HttpError?error.status:503});}
  };
  /** Restore the just-created state without rebooting workerd: wipe every
   *  application table (schema-derived, see wipeTestDatabase), reseed the
   *  fixture org/user, and — when the bundle carries the hook — clear the
   *  worker isolate's per-isolate caches. Durable Object storage is NOT
   *  wiped: shared-app suites may only rely on this where every DO they
   *  touch is addressed by a per-test random id (solo rounds by session id,
   *  rooms by room id), so stale objects are unreachable. */
  const reset=async()=>{
    await wipeTestDatabase(db);
    await seedTestDatabase(db);
    if(options.clearCachesOnReset){
      // Both cache instances: the worker isolate's (cleared via the
      // compilation-only header hook) and this Node process's own module
      // instance, which ctx-direct suites exercise through app.db.
      clearScopeSourcesCache();
      const cleared=await fetch("/api/v1/health",{headers:{"x-test-clear-caches":"1"}});
      if(cleared.status!==200)throw new Error("Shared test app cache clear did not run.");
    }
  };
  return {runtime,sourceBuildHash:createHash("sha256").update(script).digest("hex"),get db(){return db;},fetch,login,importFixture,restart,reset};
}
type NativeTestApp = Awaited<ReturnType<typeof createNativeTestApp>>;
const sharedApps = new Map<string, Promise<NativeTestApp>>();
const sharedAppCallbacks = new WeakMap<NativeTestApp, { beforeD1Statement?: unknown; onD1Meter?: unknown; beforePasswordHash?: unknown }>();
/** One app per test FILE (per worker process) for suites whose per-test boot
 *  dominates their cost. The first call creates the app; later calls reset
 *  it (D1 wipe + reseed + isolate-cache clear) instead of rebooting workerd.
 *  The cache key is the bundle signature + bindings + persistence paths —
 *  everything that changes the runtime. Per-test callbacks
 *  (beforeD1Statement/onD1Meter/beforePasswordHash) are captured by the
 *  created runtime, so a shared app refuses a different callback identity
 *  rather than silently running with the first test's closure: suites with
 *  per-test closures must keep the per-test createNativeTestApp path for
 *  those tests. Persistence/restart suites must not use this at all. */
export async function getSharedNativeTestApp(options: Parameters<typeof createNativeTestApp>[0] = {}): Promise<NativeTestApp> {
  const key = JSON.stringify([!!options.delayAuthentication, !!options.beforePasswordHash, !!options.measureD1, !!options.beforeD1Statement, !!options.onD1Meter, !!options.replaceRoomAuthority, !!options.roomTestClock, !!options.roomStorageDiagnostics, !!options.replaceSoloAuthority, !!options.soloTestClock, !!options.clearCachesOnReset, options.bindings ?? null, options.d1Persist ?? null, options.durableObjectsPersist ?? null, !!options.outboundService]);
  let pending = sharedApps.get(key);
  if (!pending) {
    pending = createNativeTestApp(options);
    sharedApps.set(key, pending);
    const app = await pending;
    sharedAppCallbacks.set(app, { beforeD1Statement: options.beforeD1Statement, onD1Meter: options.onD1Meter, beforePasswordHash: options.beforePasswordHash });
    return app;
  }
  const app = await pending;
  const first = sharedAppCallbacks.get(app);
  if (first && (first.beforeD1Statement !== options.beforeD1Statement || first.onD1Meter !== options.onD1Meter || first.beforePasswordHash !== options.beforePasswordHash))
    throw new Error("getSharedNativeTestApp: per-test callbacks differ from the creating call; keep per-test closures on createNativeTestApp.");
  await app.reset();
  return app;
}
export async function disposeSharedNativeTestApps(): Promise<void> {
  const apps = [...sharedApps.values()];
  sharedApps.clear();
  for (const pending of apps) { try { await (await pending).runtime.dispose(); } catch { /* already disposed */ } }
}
