/** Test-only stopped-source capture. Never imported by the product or closed Worker. */
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Miniflare} from 'miniflare';
// @ts-expect-error Standalone Node restore tooling has no declaration file.
import {Budget,SegmentEnd,captureObjectSegment,closedBuild} from '../../../../../scripts/lib/cloudflare-maintenance-local.mjs';
// @ts-expect-error Standalone Node restore tooling has no declaration file.
import {CAPS,TABLES,migrations,mappingIdentity,rowOperation,sha} from '../../../../../scripts/lib/cloudflare-bound-bundle.mjs';

type Scalar=string|number|null;
type Row=Record<string,Scalar>;
type Binding=Awaited<ReturnType<Miniflare['getD1Database']>>;
type Scope={kind:'room';orgId:string;seasonId:string;id:string}|{kind:'reports';orgId:string;seasonId:string};
type Schema={type:string;name:string;tbl_name:string;sql:string|null};
type TableSpec={columns:string[];pk:string[]};
type Migration={name:string;sql:string;hash:string};
type CapturedObject={scope:Scope;outbox:null;rows:{table:string;key:string;data:Scalar}[];plan:{root:string;historyRoot?:string;inventory:unknown}};
type Counters={rows:number;transmitted:number;calls:number;retries:number;largestRequest:number;largestResponse:number;returned:number};
const transient=(error:unknown)=>['ECONNRESET','ETIMEDOUT','EPIPE','UND_ERR_SOCKET'].includes((error as {code?:string;cause?:{code?:string}})?.code??(error as {cause?:{code?:string}})?.cause?.code??'');
const schemaSql="SELECT type,name,tbl_name,sql FROM sqlite_master WHERE (type,name)>(?,?) ORDER BY type,name LIMIT 1";
const columnSql='SELECT cid,name,type,"notnull",dflt_value,pk FROM pragma_table_info(?) WHERE cid>? ORDER BY cid LIMIT 1';
const counters=(budget:Counters)=>Object.fromEntries(Object.entries(budget));
const providerMetadataSchema:Schema={type:'table',name:'_cf_METADATA',tbl_name:'_cf_METADATA',sql:'CREATE TABLE _cf_METADATA (\n        key INTEGER PRIMARY KEY,\n        value BLOB\n      )'};
/** Root-approved exact engine table only. This is neither application data nor a provider backup/restore claim. */
export function classifySourceSchema(entries:Schema[]){
 const application:Schema[]=[],providerMetadata:{entry:Schema;owner:string;columns:{readable:false;reason:string};rowCount:{readable:false;reason:string}}[]=[];
 for(const entry of entries){
  if(entry.name==='_cf_METADATA'){
   assert.deepEqual(entry,providerMetadataSchema,'altered protected provider schema');assert.equal(providerMetadata.length,0,'duplicate protected provider schema');
   providerMetadata.push({entry,owner:'workerd-provider-private',columns:{readable:false,reason:'Provider SQL regulator protects this table.'},rowCount:{readable:false,reason:'Provider SQL regulator protects this table.'}});
  }else{assert(!entry.name.toLowerCase().startsWith('_cf_'),'unknown protected provider schema');application.push(entry);}
 }
 return {application,providerMetadata};
}

export async function privateJson(path:string,value:unknown){
 const temporary=path+'.pending';await writeFile(temporary,JSON.stringify(value,null,2),{mode:0o600});await rename(temporary,path);
}
export async function sourceRun(label:string){
 const path=resolve(new URL('../../../../../.local/d3-native-sources/',import.meta.url).pathname,`${new Date().toISOString().replaceAll(':','-')}-${label}-${crypto.randomUUID()}`);
 await mkdir(path,{recursive:true,mode:0o700});return {path,d1Persist:resolve(path,'original/d1'),durableObjectsPersist:resolve(path,'original/do')};
}

/** One binding call in flight; every attempted read consumes a slot and serialized body bytes. */
async function snapshotBinding(database:Binding,path:string){
 const schema=await migrations() as {id:string;list:Migration[]};
 const reference=new DatabaseSync(':memory:');for(const migration of schema.list)reference.exec(migration.sql);
 const rowMetrics:Record<string,{encodedOperationalPayloadBytes:number;maxPayloadRowBytes:number;maxWriteRequestBytes:number}>={};
 const snapshots:Record<string,unknown>[]=[];let budget=new Budget(),destination:DatabaseSync|undefined;
 const checkpoint={phase:'schema',table:'',after:null as Scalar[]|null,rows:0,segment:0};
 const flush=async()=>{if(destination){destination.exec('COMMIT');destination.exec('BEGIN');}snapshots.push({...checkpoint,...counters(budget)});await privateJson(resolve(path,'d1-checkpoint.json'),{checkpoint,segments:snapshots});checkpoint.segment++;budget=new Budget();};
 const query=async(sql:string,params:Scalar[]=[]):Promise<Row[]>=>{
  const body=JSON.stringify({sql,params});assert(Buffer.byteLength(body)<=CAPS.d1Body,'D1 request body cap');
  for(let retry=0;;retry++){
   try{budget.charge(body,1);}catch(error){if(!(error instanceof SegmentEnd))throw error;await flush();budget.charge(body,1);}
   try{const result=await database.prepare(sql).bind(...params).all<Row>();budget.received(result,CAPS.d1Body);assert(result.success);assert(result.results.length<=1,'single-row capture page');return result.results;}
   catch(error){if(!transient(error)||retry===3)throw error;budget.retries++;}
  }
 };
 const inventory=async()=>{
  const entries:Schema[]=[];let after=['',''];
  for(;;){const rows=await query(schemaSql,after);if(!rows.length)break;const entry=rows[0] as Schema;entries.push(entry);after=[entry.type,entry.name];}
  return entries;
 };
 const columns=async(name:string)=>{const entries:Row[]=[];let after=-1;for(;;){const rows=await query(columnSql,[name,after]);if(!rows.length)break;entries.push(rows[0]);after=Number(rows[0].cid);}return entries;};
 try{
  const originalSchema=await inventory();await privateJson(resolve(path,'source-schema.json'),{migrationId:schema.id,migrations:schema.list.map(({name,hash})=>({name,hash})),entries:originalSchema});
  const {application,providerMetadata}=classifySourceSchema(originalSchema);
  const tableInventory:{name:string;sql:string|null;columns:Row[];rows:number}[]=[];
  // Never query the exact protected provider table. All other metadata must match the trusted application schema.
  for(const entry of application.filter(entry=>entry.type==='table')){
   const actualColumns=await columns(entry.name),quoted='"'+entry.name.replaceAll('"','""')+'"';
   const count=Number((await query(`SELECT count(*) AS n FROM ${quoted}`))[0].n);assert(Number.isSafeInteger(count)&&count>=0);
   tableInventory.push({name:entry.name,sql:entry.sql,columns:actualColumns,rows:count});
  }
  await privateJson(resolve(path,'source-schema.json'),{migrationId:schema.id,migrations:schema.list.map(({name,hash})=>({name,hash})),entries:originalSchema,tables:tableInventory,providerMetadata});
  // Exact full schema comparison includes indexes/autoindexes/views/triggers. Unfamiliar provider metadata is retained above and rejects here.
  const expectedSchema=reference.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all();
  assert.deepEqual(application,expectedSchema.map(row=>({...row})),'unknown or changed complete D1 schema (retained in source-schema.json)');
  const management=new Set(['MaintenanceReceipt','MaintenanceArchives']);
  for(const table of tableInventory){
   assert(Object.hasOwn(TABLES,table.name)||management.has(table.name),'unknown table');
   assert.deepEqual(table.columns,reference.prepare(`PRAGMA table_info(${table.name})`).all().map(row=>({...row})),'source column type/PK differs');
   if(management.has(table.name))assert.equal(table.rows,0,'nonempty source management table');
  }
  assert(tableInventory.reduce((sum,t)=>sum+t.rows,0)<=CAPS.rows,'source row cap');
  const temporary=resolve(path,'snapshot.pending.sqlite');destination=new DatabaseSync(temporary);
  for(const migration of schema.list)destination.exec(migration.sql);destination.exec('PRAGMA foreign_keys=ON; BEGIN; PRAGMA defer_foreign_keys=ON');
  const transfer=async(verify:boolean)=>{
   checkpoint.phase=verify?'verify':'copy';
   for(const [name,spec] of Object.entries(TABLES) as [string,TableSpec][]){
    if(management.has(name))continue;checkpoint.table=name;checkpoint.after=null;let count=0;
    const insert=destination!.prepare(`INSERT INTO ${name}(${spec.columns.join(',')}) VALUES(${spec.columns.map(()=>'?').join(',')})`);
    const read=destination!.prepare(`SELECT ${spec.columns.join(',')} FROM ${name} WHERE ${spec.pk.map(k=>`${k}=?`).join(' AND ')}`);
    for(;;){
     const sql:string=`SELECT ${spec.columns.join(',')} FROM ${name}${checkpoint.after?` WHERE (${spec.pk.join(',')})>(${spec.pk.map(()=>'?').join(',')})`:''} ORDER BY ${spec.pk.join(',')} LIMIT 1`;
     const rows:Row[]=await query(sql,checkpoint.after??[]);if(!rows.length)break;const row:Row=rows[0];const operation=rowOperation(name,row);
     if(!verify){const metrics=rowMetrics[name]??={encodedOperationalPayloadBytes:0,maxPayloadRowBytes:0,maxWriteRequestBytes:0};metrics.encodedOperationalPayloadBytes+=operation.payload;metrics.maxPayloadRowBytes=Math.max(metrics.maxPayloadRowBytes,operation.payload);metrics.maxWriteRequestBytes=Math.max(metrics.maxWriteRequestBytes,Buffer.byteLength(operation.body));}
     const identity:Scalar[]=spec.pk.map(k=>row[k]);
     if(verify)assert.deepEqual({...read.get(...identity)},row,'full-field source recheck differs');else{insert.run(...spec.columns.map(k=>row[k]));assert.deepEqual({...read.get(...identity)},row,'local scalar readback differs');}
     count++;checkpoint.rows++;checkpoint.after=identity;
    }
    const original=tableInventory.find(table=>table.name===name)!;assert.equal(count,original.rows,'source count changed');assert.equal(Number(destination!.prepare(`SELECT count(*) AS n FROM ${name}`).get()!.n),count);
   }
  };
  await transfer(false);await transfer(true);checkpoint.phase='final-seal';assert.deepEqual(await inventory(),originalSchema,'source schema changed');
  for(const table of tableInventory)assert.equal(Number((await query(`SELECT count(*) AS n FROM ${table.name}`))[0].n),table.rows,'source final count changed');
  assert.equal(destination.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok');assert.equal(destination.prepare('PRAGMA foreign_key_check').all().length,0);
  destination.exec('COMMIT');destination.close();destination=undefined;
  snapshots.push({...checkpoint,...counters(budget)});await rename(temporary,resolve(path,'source.sqlite'));
  await privateJson(resolve(path,'d1-checkpoint.json'),{checkpoint:{...checkpoint,phase:'complete'},segments:snapshots});
  return {schemaId:schema.id,tables:tableInventory,providerMetadata,rowMetrics,schema:originalSchema,segments:snapshots,sha256:sha(await readFile(resolve(path,'source.sqlite')))};
 }catch(error){await privateJson(resolve(path,'d1-checkpoint.json'),{checkpoint:{...checkpoint,phase:'failed'},segments:[...snapshots,counters(budget)],message:error instanceof Error?error.message:String(error)});throw error;}finally{destination?.close();reference.close();}
}

/** The normal source must already be disposed; this opens only the separate closed entrypoint on the same persistence. */
export async function captureStoppedSource(run:Awaited<ReturnType<typeof sourceRun>>,scopes:Scope[],historyRow:Row,expected:Record<string,unknown>){
 const build=await closedBuild(),schema=await migrations(),mappingId=await mappingIdentity('native-declared-stopped');
 const bundleId=sha(JSON.stringify([run.path,scopes])),targetId=sha(run.path),identity={bundleId,targetId,buildId:build.id,schemaId:schema.id,mappingId,ticket:sha(JSON.stringify([bundleId,targetId,build.id]))};
 await privateJson(resolve(run.path,'capture-identity.json'),identity);
 const runtime=new Miniflare({modules:true,script:build.script,compatibilityDate:'2026-05-22',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'test-native'},d1Persist:run.d1Persist,durableObjectsPersist:run.durableObjectsPersist,durableObjects:{ROOMS:{className:'PracticeRoom',useSQLite:true},REPORTS:{className:'PracticeReports',useSQLite:true},PBE_SOLO:{className:'PbeSoloRound',useSQLite:true},PASSWORD_CRYPTO:{className:'PasswordCrypto',useSQLite:true}},bindings:{NATIVE_MAINTENANCE_MODE:'offline-v1',NATIVE_MAINTENANCE_IDENTITY:JSON.stringify(identity)}});
 try{
  assert.equal((await runtime.dispatchFetch('https://erudoza.test/api/v1/auth/login')).status,404);
  const database=await runtime.getD1Database('DB'),local={runtime,database,identity};
  const d1=await snapshotBinding(database,run.path),objects:CapturedObject[]=[],segments:Record<string,unknown>[]=[];
  for(const scope of scopes){
   let state=null;for(;;){const result=await captureObjectSegment(local,scope,scope.kind==='room'?historyRow:undefined,state,new Budget());state=result.state;segments.push({scope,...counters(result.budget),complete:result.complete});await privateJson(resolve(run.path,`object-${scope.kind}-checkpoint.json`),{state,segments});if(result.complete){objects.push(result.object);break;}}
  }
  const declaration={kind:'native-declared-stopped',exhaustive:true,stopped:true,scope:'selected-scope',namespaces:scopes,providerMetadata:d1.providerMetadata};
  await privateJson(resolve(run.path,'inventory.json'),{source:declaration,objects});
  const files=['source.sqlite','inventory.json','source-schema.json','capture-identity.json','source-expected.json','normal-disposed.json','d1-checkpoint.json',...scopes.map(scope=>`object-${scope.kind}-checkpoint.json`)];const hashes:Record<string,string>={};for(const name of files)hashes[name]=sha(await readFile(resolve(run.path,name)));
  const manifest={...expected,identity,providerMetadata:d1.providerMetadata,originalPersistence:{d1:run.d1Persist,durableObjects:run.durableObjectsPersist},closedInbound:404,sourceDeclaration:declaration,bindings:{d1Id:'test-native',ROOMS:'PracticeRoom',REPORTS:'PracticeReports',PBE_SOLO:'PbeSoloRound',PASSWORD_CRYPTO:'PasswordCrypto'},d1,objects:objects.map(object=>({scope:object.scope,rows:object.rows.length,tables:Object.fromEntries([...new Set(object.rows.map(row=>row.table))].map(table=>{const rows=object.rows.filter(row=>row.table===table);return [table,{rows:rows.length,dataBytes:rows.reduce((n,row)=>n+(row.data===null?0:Buffer.byteLength(String(row.data))),0),keyBytes:rows.reduce((n,row)=>n+Buffer.byteLength(row.key),0),encodedBytes:rows.reduce((n,row)=>n+Buffer.byteLength(JSON.stringify(row)),0)}];})),rootHash:sha(object.plan.root),historyRootHash:object.plan.historyRoot?sha(object.plan.historyRoot):null,inventory:object.plan.inventory})),segments,hashes,closedDisposed:false};
  await runtime.dispose();manifest.closedDisposed=true;await privateJson(resolve(run.path,'expected.json'),manifest);
  return {path:run.path,hashes:{...hashes,'expected.json':sha(await readFile(resolve(run.path,'expected.json')))},d1,objects:manifest.objects,segments};
 }catch(error){await runtime.dispose();await privateJson(resolve(run.path,'capture-failure.json'),{message:error instanceof Error?error.message:String(error),closedDisposed:true});throw error;}
}

/** Reuses stopped original persistence; each attempt has independent evidence and never reruns gameplay. */
export async function resumeStoppedSource(originalPath:string){
 const original=resolve(originalPath),normal=await readFile(resolve(original,'normal-disposed.json')),sourceBytes=await readFile(resolve(original,'source-expected.json'));
 const saved=JSON.parse(sourceBytes.toString('utf8')),closed=JSON.parse(await readFile(resolve(original,'capture-failure.json'),'utf8'));
 assert.equal(JSON.parse(normal.toString('utf8')).disposed,true);assert.equal(closed.closedDisposed,true);assert.equal(saved.authority.status,'Completed');assert.equal(saved.diagnostic.outbox,null);assert.equal(saved.diagnostic.alarmAt,null);
 const path=resolve(original,`capture-attempt-${new Date().toISOString().replaceAll(':','-')}-${crypto.randomUUID()}`);await mkdir(path,{mode:0o700});
 await writeFile(resolve(path,'source-expected.json'),sourceBytes,{mode:0o600});await writeFile(resolve(path,'normal-disposed.json'),normal,{mode:0o600});
 const run={path,d1Persist:resolve(original,'original/d1'),durableObjectsPersist:resolve(original,'original/do')};
 const scope={orgId:saved.authority.orgId as string,seasonId:saved.authority.seasonId as string};
 const result=await captureStoppedSource(run,[{kind:'room',...scope,id:saved.authority.id},{kind:'reports',...scope}],saved.historyRow,{kind:saved.kind,resumedFrom:original,normalDisposed:true,sourceExpectedPath:resolve(path,'source-expected.json'),sourceBuildHash:saved.sourceBuildHash,originalExpectedHash:sha(sourceBytes),originalCheckpoint:{status:saved.authority.status,questions:saved.authority.questions.length,members:saved.authority.members.length,finals:saved.authority.submissions.length,terminalCommandId:saved.terminalRetry.input.commandId,terminalActor:saved.terminalRetry.actor}});
 await privateJson(resolve(path,'source-capture-result.json'),result);return result;
}
