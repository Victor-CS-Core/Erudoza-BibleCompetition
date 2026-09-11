import { readFile } from "node:fs/promises";
import { pbkdf2Sync } from "node:crypto";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { authenticate } from './auth';
import { importPack } from './application/content';
import { Store } from './store';
import { admin, body, HttpError } from './types';
import type { Env } from './types';
// @ts-expect-error Standalone Node migration module.
import { readNativeMigrations } from '../../scripts/native-migrations.mjs';
export const TEST_ORG="11111111-1111-4111-8111-111111111111";
export const TEST_USER="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export async function createNativeTestApp(options:{delayAuthentication?:boolean}={}) {
  // Test-only compilation hook: exercise ingress ordering while authentication waits.
  // No delay header or equivalent bypass is included in the deployed bundle.
  const plugins=options.delayAuthentication?[{name:"test-auth-delay",setup(builder:import("esbuild").PluginBuild){builder.onLoad({filter:/native[/\\]auth\.ts$/},async args=>{
    const source=await readFile(args.path,"utf8"),signature='export async function authenticate(request:Request,env:Env,practiceOrgId?:string):Promise<Actor> {';
    if(source.split(signature).length!==2)throw new Error("Authentication delay hook no longer matches the shared lookup.");
    return {loader:"ts",contents:source.replace(signature,`${signature} if(request.headers.has("x-test-auth-delay")) await new Promise(resolve=>setTimeout(resolve,1500));`)};
  });}}]:[];
  const bundle=await build({entryPoints:[new URL("./index.ts",import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,"$1")],bundle:true,write:false,format:"esm",platform:"neutral",target:"es2022",external:["cloudflare:workers"],plugins});
  const runtime=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:"2026-05-22",d1Databases:{DB:"test-native"},durableObjects:{ROOMS:{className:"PracticeRoom",useSQLite:true},REPORTS:{className:"PracticeReports",useSQLite:true},PASSWORD_CRYPTO:{className:"PasswordCrypto",useSQLite:true}},bindings:{PUBLIC_ORIGIN:"https://erudoza.test"}});
  const db=await runtime.getD1Database("DB");
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
  return {runtime,db,fetch,login,importFixture};
}
