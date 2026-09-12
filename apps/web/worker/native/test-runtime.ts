import { readFile } from "node:fs/promises";
import { pbkdf2Sync } from "node:crypto";
import { build } from "esbuild";
import { Miniflare, Response as TestServiceResponse } from "miniflare";
import type { Request as TestRequest, Response as TestResponse } from "miniflare";
import { authenticate } from './auth';
import { importPack } from './application/content';
import { Store } from './store';
import { admin, body, HttpError } from './types';
import {roomTestHooks} from './test-room-hooks';
import type { Env } from './types';
// @ts-expect-error Standalone Node migration module.
import { readNativeMigrations } from '../../scripts/native-migrations.mjs';
export const TEST_ORG="11111111-1111-4111-8111-111111111111";
export const TEST_USER="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export async function createNativeTestApp(options:{measureD1?:boolean;onD1Meter?:(meter:{bindingCalls:number;statements:number;methods:Record<string,number>})=>void;beforeD1Statement?:(sql:string)=>Promise<void>;delayAuthentication?:boolean;replaceSoloAuthority?:boolean;replaceRoomAuthority?:boolean;roomTestClock?:boolean;roomStorageDiagnostics?:boolean;beforePasswordHash?:()=>Promise<void>;bindings?:Record<string,string>;outboundService?:(request:TestRequest)=>Promise<TestResponse>}={}) {
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
  if(options.measureD1||options.beforeD1Statement||options.onD1Meter)plugins.push({name:"test-d1-meter",setup(builder:import("esbuild").PluginBuild){builder.onLoad({filter:/native[/\\]index\.ts$/},async args=>{
    const source=await readFile(args.path,"utf8"),signature='export default {';
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
  if(options.replaceSoloAuthority)plugins.push({name:"test-solo-replacement",setup(builder:import("esbuild").PluginBuild){builder.onLoad({filter:/native[/\\]pbe[/\\]solo-round\.ts$/},async args=>{
    const source=await readFile(args.path,"utf8"),signature="      const url=new URL(request.url),expected=url.searchParams.get('questionId'),input=request.method==='POST'?await body<Input>(request,32768):null,ingress=Date.now();";
    if(source.split(signature).length!==2)throw new Error("Solo replacement hook no longer matches the authority ingress.");
    const replacement=`${signature}\n      if(request.headers.has('x-test-authority-replaced')){const replaced=this.load();if(replaced){replaced.epoch='test-replaced-authority';this.save(replaced);await this.ctx.storage.setAlarm(Date.now());}return json({status:'replacement-scheduled'});}`;
    return {loader:"ts",contents:source.replace(signature,replacement)};
  });}});
  const bundle=await build({entryPoints:[new URL("./index.ts",import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,"$1")],bundle:true,write:false,format:"esm",platform:"neutral",target:"es2022",external:["cloudflare:workers","node:async_hooks"],plugins});
  const outboundService=options.beforePasswordHash||options.beforeD1Statement||options.onD1Meter?async(request:TestRequest)=>{
    if(request.url==="https://native-test.invalid/d1-meter"&&options.onD1Meter){options.onD1Meter(await request.json() as Parameters<NonNullable<typeof options.onD1Meter>>[0]);return new TestServiceResponse(null,{status:204});}
    if(request.url==="https://native-test.invalid/d1-statement"&&options.beforeD1Statement){await options.beforeD1Statement(await request.text());return new TestServiceResponse(null,{status:204});}
    if(request.url==="https://native-test.invalid/before-password-hash") {await options.beforePasswordHash!();return new TestServiceResponse(null,{status:204});}
    if(options.outboundService)return options.outboundService(request);
    throw new Error("Unexpected network request in native concurrency test");
  }:options.outboundService;
  const runtimeOptions:ConstructorParameters<typeof Miniflare>[0]={modules:true,script:bundle.outputFiles[0].text,compatibilityDate:"2026-05-22",compatibilityFlags:["nodejs_compat"],d1Databases:{DB:"test-native"},durableObjects:{ROOMS:{className:"PracticeRoom",useSQLite:true},REPORTS:{className:"PracticeReports",useSQLite:true},PASSWORD_CRYPTO:{className:"PasswordCrypto",useSQLite:true},PBE_SOLO:{className:"PbeSoloRound",useSQLite:true}},bindings:{PUBLIC_ORIGIN:"https://erudoza.test",...options.bindings},outboundService};
  const runtime=new Miniflare(runtimeOptions);
  let db=await runtime.getD1Database("DB");
  const restart=async()=>{await runtime.setOptions({...runtimeOptions,bindings:{...runtimeOptions.bindings,FIXTURE_RESTART:crypto.randomUUID()}});db=await runtime.getD1Database("DB");};
  for(const migration of await readNativeMigrations()) await db.batch(migration.statements.map((sql:string)=>db.prepare(sql)));
  const salt=Buffer.alloc(16,3),hash=`pbkdf2:${salt.toString("base64")}:${pbkdf2Sync("Testing!123",salt,100000,32,"sha256").toString("base64")}`;
  await db.prepare("INSERT INTO Organizations(id,name,slug) VALUES(?,?,?)").bind(TEST_ORG,"Practice Club","practice-club").run();
  await db.prepare("INSERT INTO Users(id,org_id,user_name,display_name,kind,role,password_hash,credential_version) VALUES(?,?,?,?,?,?,?,?)").bind(TEST_USER,TEST_ORG,"coach","Coach","Adult","Owner",hash,"v1").run();
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
  return {runtime,get db(){return db;},fetch,login,importFixture,restart};
}
