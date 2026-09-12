/* global process, Buffer, console, URL */
// Ephemeral, loopback-only fixture server. Never used for production bootstrap.
import {cp,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {pbkdf2Sync,randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {createServer} from 'node:http';
import {loadLibrary,seedStatements} from './nkjv-library.mjs';
import {readNativeMigrations} from './native-migrations.mjs';
const root=new URL('../',import.meta.url),origin='http://localhost:8789';
const password=process.env.ERUDOZA_E2E_PASSWORD;if(!password)throw new Error('Explicit E2E password required.');
if(process.env.ERUDOZA_NATIVE_PID_FILE){await mkdir(new URL('test-results/',root),{recursive:true});await writeFile(process.env.ERUDOZA_NATIVE_PID_FILE,String(process.pid));}
const assetSnapshot=new URL(`test-results/native-assets/${randomUUID()}/`,root);await cp(new URL('dist-native',root),assetSnapshot,{recursive:true});
const bundle=await build({entryPoints:[fileURLToPath(new URL('worker/native/index.ts',root))],bundle:true,write:false,format:'esm',platform:'neutral',external:['cloudflare:workers']});
const runtime=new Miniflare({name:'erudoza-fixture',host:'127.0.0.1',port:8789,modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-05-22',d1Databases:{DB:'native-e2e'},durableObjects:{ROOMS:{className:'PracticeRoom',useSQLite:true},REPORTS:{className:'PracticeReports',useSQLite:true},PASSWORD_CRYPTO:{className:'PasswordCrypto',useSQLite:true},PBE_SOLO:{className:'PbeSoloRound',useSQLite:true}},bindings:{PUBLIC_ORIGIN:origin},assets:{directory:fileURLToPath(assetSnapshot),binding:'ASSETS',routerConfig:{has_user_worker:true,invoke_user_worker_ahead_of_assets:true},assetConfig:{not_found_handling:'single-page-application'}}});
const db=await runtime.getD1Database('DB');
for(const migration of await readNativeMigrations())await db.batch(migration.statements.map(sql=>db.prepare(sql)));
for(const statement of seedStatements(await loadLibrary()))await db.prepare(statement).run();
const org=randomUUID(),salt=Buffer.alloc(16,7),hash=`pbkdf2:${salt.toString('base64')}:${pbkdf2Sync(password,salt,100000,32,'sha256').toString('base64')}`;
await db.prepare('INSERT INTO Organizations(id,name,slug) VALUES(?,?,?)').bind(org,'Native browser fixture','native-fixture').run();
for(const [user,kind,role] of [['admin@erudoza.local','Adult','Owner'],['student.fixture','Student','Student']])await db.prepare('INSERT INTO Users(id,org_id,user_name,display_name,kind,role,password_hash,credential_version) VALUES(?,?,?,?,?,?,?,?)').bind(randomUUID(),org,user,user,kind,role,hash,randomUUID()).run();
const pack=randomUUID();
async function record(kind,id,data,owner=null){await db.prepare('INSERT INTO Records(kind,id,org_id,owner_id,data) VALUES(?,?,?,?,?)').bind(kind,id,org,owner,JSON.stringify(data)).run();}
await record('pack',pack,{id:pack,packKey:'dev-daniel',version:1,locale:'en',sourceType:'Scripture',licensingStatus:'development-sample',isActive:true,unitCount:12,createdAtUtc:new Date().toISOString()});
for(let verse=1;verse<=12;verse++){const id=randomUUID();await record('source',id,{id,contentPackId:pack,bookKey:'DAN',chapter:1,verse,ordinal:verse,citation:`Daniel 1:${verse}`,canonicalText:`Daniel studied this synthetic development passage number ${verse}.`,isActive:true},pack);}
await runtime.ready;
// The Worker starts listening before fixture seeding finishes. Playwright waits on
// this separate loopback readiness socket so login cannot race initial accounts.
const readyServer=createServer((request,response)=>{response.writeHead(request.url==='/ready'?204:404);response.end();});
await new Promise((resolve,reject)=>{readyServer.once('error',reject);readyServer.listen(8790,'127.0.0.1',resolve);});
console.log(`Native fixture ready at ${origin}`);
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{readyServer.close();await runtime.dispose();process.exit(0);});
