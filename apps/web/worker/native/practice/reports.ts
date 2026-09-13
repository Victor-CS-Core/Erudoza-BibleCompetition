import {maintenanceOffline,dispatchMaintenance,MAINTENANCE_PREFIX} from '../maintenance/protocol';
import {prepareTeamHonors} from '../mastery/store';
import {DurableObject} from 'cloudflare:workers';
import type {Env} from '../types';
import {body,json} from '../types';
import {Store} from '../store';
import type {Room} from './state';
import {overlayRoom,type PbeResultOverlay} from '../pbe/result-overlays';
import {simulationHonorStatements} from './simulation-awards';
import {calculateAwards} from './awards';
import {listRoomSummaries,summarizeRoom,type RoomHistorySummary,type RoomHistoryEnvelope} from './room-history';
import {contentHash,manifestRefs,parseNode,validateManifest,ROOM_STAGE_BYTES,ROOM_STAGE_NODES,ROOM_STORAGE_FORMAT,type RoomManifest} from './room-storage';
export {calculateAwards,trends} from './awards';
export type {Award} from './awards';
interface Scope {id:string;orgId:string;seasonId:string}
interface Stage extends Scope {nodes:{hash:string;data:string}[]}
interface Publication {manifest:RoomManifest;summary:RoomHistorySummary}
/** One projection authority per organization/season prevents cross-room award races. */
export class PracticeReports extends DurableObject<Env>{
 constructor(ctx:DurableObjectState,env:Env){super(ctx,env);if(maintenanceOffline(env))return;ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS verification(root TEXT,hash TEXT,done INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(root,hash))');ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS publications(root TEXT PRIMARY KEY,data TEXT NOT NULL)');ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS scope(id INTEGER PRIMARY KEY,data TEXT NOT NULL)');}
 private tail:Promise<void>=Promise.resolve();
 private bindScope(s:Scope){if(![s.id,s.orgId,s.seasonId].every(x=>typeof x==='string'&&x.length>0&&x.length<=100))throw new Error('Invalid history scope.');const value=JSON.stringify([s.orgId,s.seasonId]),old=this.ctx.storage.sql.exec<{data:string}>('SELECT data FROM scope WHERE id=1').toArray()[0];if(old&&old.data!==value)throw new Error('History scope conflict.');if(!old)this.ctx.storage.sql.exec('INSERT INTO scope(id,data) VALUES(1,?)',value);}
 private async stage(input:Stage){
  if(maintenanceOffline(this.env))throw new Error('Offline maintenance.');
  this.bindScope(input);if(!Array.isArray(input.nodes)||!input.nodes.length||input.nodes.length>ROOM_STAGE_NODES)throw new Error('Invalid history stage.');
  for(const n of input.nodes)await parseNode(n.hash,n.data);
  await this.env.DB.batch(input.nodes.map(n=>this.env.DB.prepare('INSERT INTO PracticeRoomComponents(org_id,season_id,room_id,hash,data) VALUES(?,?,?,?,?) ON CONFLICT(org_id,season_id,room_id,hash) DO UPDATE SET data=CASE WHEN PracticeRoomComponents.data=excluded.data THEN PracticeRoomComponents.data ELSE NULL END').bind(input.orgId,input.seasonId,input.id,n.hash,n.data)));
  return json({acknowledged:input.nodes.map(n=>n.hash)});
 }
 private async verify(input:Publication):Promise<boolean>{
  if(maintenanceOffline(this.env))throw new Error('Offline maintenance.');
  const m=input.manifest;validateManifest(m);this.bindScope(m);if(input.summary.summaryVersion!==1||input.summary.id!==m.id||input.summary.orgId!==m.orgId||input.summary.seasonId!==m.seasonId||input.summary.revision!==m.revision||!['Completed','Interrupted'].includes(input.summary.status))throw new Error('Invalid terminal history.');
  const data=JSON.stringify(input),root=await contentHash(data),old=this.ctx.storage.sql.exec<{data:string}>('SELECT data FROM publications WHERE root=?',root).toArray()[0];
  if(old&&old.data!==data)throw new Error('Publication identity conflict.');
  if(!old)this.ctx.storage.transactionSync(()=>{this.ctx.storage.sql.exec('INSERT INTO publications(root,data) VALUES(?,?)',root,data);for(const ref of manifestRefs(m))this.ctx.storage.sql.exec('INSERT OR IGNORE INTO verification(root,hash) VALUES(?,?)',root,ref.hash);});
  const pending=this.ctx.storage.sql.exec<{hash:string}>('SELECT hash FROM verification WHERE root=? AND done=0 ORDER BY hash LIMIT ?',root,ROOM_STAGE_NODES).toArray();
  if(pending.length){
   const rows=await this.env.DB.prepare('SELECT hash,data FROM PracticeRoomComponents WHERE org_id=? AND season_id=? AND room_id=? AND hash IN (SELECT value FROM json_each(?))').bind(m.orgId,m.seasonId,m.id,JSON.stringify(pending.map(n=>n.hash))).all<{hash:string;data:string}>();
   const missing=pending.filter(p=>!rows.results.some(r=>r.hash===p.hash));if(missing.length)throw new Error('History components missing: '+missing.map(n=>n.hash).join(','));
   const parsed:{hash:string;node:Awaited<ReturnType<typeof parseNode>>}[]=[];for(const row of rows.results)parsed.push({hash:row.hash,node:await parseNode(row.hash,row.data)});
   this.ctx.storage.transactionSync(()=>{for(const {hash,node} of parsed){if(node.type==='branch')for(const child of node.children)this.ctx.storage.sql.exec('INSERT OR IGNORE INTO verification(root,hash) VALUES(?,?)',root,child);this.ctx.storage.sql.exec('UPDATE verification SET done=1 WHERE root=? AND hash=?',root,hash);}});
  }
  if(this.ctx.storage.sql.exec('SELECT 1 FROM verification WHERE root=? AND done=0 LIMIT 1',root).toArray().length)return false;
  // Recheck the complete immutable closure's existence immediately before publication.
  const hashes=this.ctx.storage.sql.exec<{hash:string}>('SELECT hash FROM verification WHERE root=? ORDER BY hash',root).toArray().map(n=>n.hash);
  const missing=await this.env.DB.prepare('SELECT value AS hash FROM json_each(?) expected WHERE NOT EXISTS(SELECT 1 FROM PracticeRoomComponents c WHERE c.org_id=? AND c.season_id=? AND c.room_id=? AND c.hash=expected.value) LIMIT 8').bind(JSON.stringify(hashes),m.orgId,m.seasonId,m.id).all<{hash:string}>();
  if(missing.results.length)throw new Error('History components missing: '+missing.results.map(n=>n.hash).join(','));
  return true;
 }
 private async publish(r:RoomHistorySummary,raw:Room|RoomHistoryEnvelope,review:boolean){
  if(maintenanceOffline(this.env))throw new Error('Offline maintenance.');
  const store=new Store(this.env.DB),old=await store.get<Room|RoomHistoryEnvelope>('match',r.id,r.orgId);
  if(!review&&old&&old.revision>r.revision)return json({projected:true});
  if(!review&&old&&old.revision===r.revision){if(r.format==='Pbe'&&JSON.stringify(old.value)!==JSON.stringify(raw))throw new Error('Conflicting history at the same revision.');return json({projected:true});}
  const all=(await listRoomSummaries(this.env.DB,r.orgId,r.seasonId)).filter(x=>x.id!==r.id);all.push(r);
  const ids=all.filter(x=>x.format==='Pbe').map(x=>`Team:${x.id}`),overlays=ids.length?await store.getMany<PbeResultOverlay>('pbe-result-overlay',ids,r.orgId):[];
  const byId=new Map(overlays.map(o=>[o.value.id,o.value])),awards=calculateAwards(all.map(x=>overlayRoom(x,byId.get(`Team:${x.id}`))));
  // Guard all observed overlay revisions, including absence, in the same publication batch.
  const guards=ids.map(id=>({id,revision:overlays.find(o=>o.value.id===id)?.revision??0}));
  const guard=this.env.DB.prepare("INSERT INTO Records(kind,id,org_id,data) VALUES('practice-projection-guard',?,?,CASE WHEN NOT EXISTS(SELECT 1 FROM json_each(?) g WHERE coalesce((SELECT revision FROM Records WHERE kind='pbe-result-overlay' AND id=json_extract(g.value,'$.id') AND org_id=?),0)<>json_extract(g.value,'$.revision')) THEN '{}' ELSE 'invalid-json' END) ON CONFLICT(kind,id,org_id) DO UPDATE SET data=excluded.data").bind(r.seasonId,r.orgId,JSON.stringify(guards),r.orgId);
  const statements=[guard];
  if(!review)statements.push(this.env.DB.prepare("INSERT INTO Records(kind,id,org_id,season_id,data,revision) VALUES('match',?,?,?,?,?) ON CONFLICT(kind,id,org_id) DO UPDATE SET data=excluded.data,revision=excluded.revision").bind(r.id,r.orgId,r.seasonId,JSON.stringify(raw),r.revision));
  const pbe=r.format==='Pbe',selectedAwards=awards.filter(a=>a.key.startsWith('pbe-team-v1:')===pbe);
  statements.push(this.env.DB.prepare(`DELETE FROM Records WHERE kind='award' AND org_id=? AND season_id=? AND (json_extract(data,'$.key') LIKE 'pbe-team-v1:%')=?`).bind(r.orgId,r.seasonId,pbe?1:0));
  statements.push(this.env.DB.prepare("INSERT INTO Records(kind,id,org_id,season_id,owner_id,data) SELECT 'award',json_extract(value,'$.key')||':'||json_extract(value,'$.userId')||':'||?, ?, ?,json_extract(value,'$.userId'),value FROM json_each(?)").bind(r.seasonId,r.orgId,r.seasonId,JSON.stringify(selectedAwards)));
  if(r.format!=='Pbe'){
   const legacy=await this.env.DB.prepare("SELECT data FROM Records WHERE kind='match' AND org_id=? AND season_id=? AND coalesce(json_extract(data,'$.format'),'Arcade')='Arcade'").bind(r.orgId,r.seasonId).all<{data:string}>();
   const rooms=legacy.results.map(x=>JSON.parse(x.data) as Room).filter(x=>x.id!==r.id);rooms.push(raw as Room);statements.push(...prepareTeamHonors(store,r.orgId,rooms,raw as Room));
  }
  if(r.simulation)statements.push(...simulationHonorStatements(this.env.DB,r.orgId,r.seasonId,all.map(x=>overlayRoom(x,byId.get(`Team:${x.id}`)))));
  await this.env.DB.batch(statements);return json({projected:true});
 }
 async fetch(request:Request):Promise<Response>{
  if(maintenanceOffline(this.env))return dispatchMaintenance(request,this.ctx.storage,this.env,'reports',this.ctx.id.toString());
  if(new URL(request.url).pathname.startsWith(MAINTENANCE_PREFIX))return new Response(null,{status:404});
  const input=await body<Stage|Publication|Scope|Room>(request,ROOM_STAGE_BYTES),previous=this.tail;let release!:()=>void;this.tail=new Promise<void>(resolve=>release=resolve);await previous;
  try{
   const path=new URL(request.url).pathname;
   if(path==='/stage')return await this.stage(input as Stage);
   if(path==='/project-components'){
    const publication=input as Publication;if(!await this.verify(publication))return json({projected:false});
    return await this.publish(publication.summary,{format:ROOM_STORAGE_FORMAT,...publication},false);
   }
   const scope=input as Scope;this.bindScope(scope);
   if(path==='/review'){
    const saved=await new Store(this.env.DB).get<Room|RoomHistoryEnvelope>('match',scope.id,scope.orgId);if(!saved)return json({projected:true});
    if(saved.value.format===ROOM_STORAGE_FORMAT){const envelope=saved.value as RoomHistoryEnvelope;return await this.publish(envelope.summary,envelope,true);}
    return await this.publish(summarizeRoom(saved.value as Room),saved.value,true);
   }
   const room=input as Room;return await this.publish(summarizeRoom(room),room,false);
  }catch(error){return json({projected:false,error:error instanceof Error?error.message:'Projection failed'},503);}finally{release();}
 }
}
