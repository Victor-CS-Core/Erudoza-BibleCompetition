import type {Env} from '../types';
import {HttpError} from '../types';
import type {Room,Submission} from './state';
import {ROOM_STORAGE_FORMAT,RoomCodec,isRoomManifest,manifestRefs,parseNode,validateManifest,type RoomManifest} from './room-storage';

export type ScoreSubmission=Omit<Submission,'answers'>&{answers?:string[];unanswered?:boolean};
export type RoomStats=Pick<Room,'id'|'orgId'|'seasonId'|'revision'|'format'|'status'|'teamCount'|'teamSize'|'questionCount'|'coached'|'bookKey'|'rules'|'completedAt'|'members'|'contributions'>&{
 questions:{id:string;version:number;sourceUnitId:string;parts:{points:number}[]}[];submissions:ScoreSubmission[];
};
export interface RoomHistorySummary extends RoomStats {summaryVersion:1}
export interface RoomHistoryEnvelope {format:typeof ROOM_STORAGE_FORMAT;manifest:RoomManifest;summary:RoomHistorySummary}
export function summarizeRoom(r:Room):RoomHistorySummary{
 const {id,orgId,seasonId,revision,format,status,teamCount,teamSize,questionCount,coached,bookKey,rules,completedAt,members,contributions}=r;
 return {summaryVersion:1,id,orgId,seasonId,revision,format,status,teamCount,teamSize,questionCount,coached,bookKey,rules,completedAt,members,contributions,questions:r.questions.map(q=>({id:q.id,version:q.version,sourceUnitId:q.sourceUnitId,parts:q.parts.map(p=>({points:p.points}))})),submissions:r.submissions.map(({answers,...s})=>({...s,unanswered:answers.every(a=>!a.trim())}))};
}
// Project legacy summaries in SQLite too: answer keys and full answers never enter a bootstrap collection.
const fields=['id','orgId','seasonId','revision','format','status','teamCount','teamSize','questionCount','coached','bookKey','rules','completedAt','members','contributions'];
const finalFields=['attemptId','responseLockedAtMs','questionId','team','scribeId','elapsedMs','deadlineDraft','accuracyHundredths','speedHundredths','appealed','resolved','appealReason'];
const objectFields=(names:string[],source:string)=>names.map(name=>`'${name}',json_extract(${source},'$.${name}')`).join(',');
const legacySummary=`json_patch(json_object('summaryVersion',1,${objectFields(fields,'r.data')}),json_object('questions',json((SELECT json_group_array(json_object('id',json_extract(q.value,'$.id'),'version',json_extract(q.value,'$.version'),'sourceUnitId',json_extract(q.value,'$.sourceUnitId'),'parts',json((SELECT json_group_array(json_object('points',json_extract(p.value,'$.points'))) FROM json_each(q.value,'$.parts') p)))) FROM json_each(r.data,'$.questions') q)),'submissions',json((SELECT json_group_array(json_object(${objectFields(finalFields,'s.value')},'unanswered',NOT EXISTS(SELECT 1 FROM json_each(s.value,'$.answers') a WHERE length(trim(a.value,char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)))>0))) FROM json_each(r.data,'$.submissions') s))))`;
export async function listRoomSummaries(db:Env['DB'],org:string,season?:string):Promise<RoomHistorySummary[]>{
 const rows=await db.prepare(`SELECT CASE WHEN json_extract(r.data,'$.format')=? THEN json_extract(r.data,'$.summary') ELSE ${legacySummary} END AS data FROM Records r WHERE kind='match' AND org_id=? ${season?'AND season_id=?':''} ORDER BY id LIMIT 5001`).bind(ROOM_STORAGE_FORMAT,org,...(season?[season]:[])).all<{data:string}>();
 if(rows.results.length>5000)throw new HttpError(413,'This collection exceeds the pilot query limit. Use a narrower scope or paginated export.');
 return rows.results.map(r=>JSON.parse(r.data) as RoomHistorySummary);
}
/** Only targeted rich-history callers use this decoder; summary collections do not hydrate components. */
export async function readRoomHistory(db:Env['DB'],org:string,id:string):Promise<{value:Room;revision:number}|null>{
 const row=await db.prepare("SELECT data,revision,season_id FROM Records WHERE kind='match' AND org_id=? AND id=?").bind(org,id).first<{data:string;revision:number;season_id:string}>();if(!row)return null;
 const value=JSON.parse(row.data) as Room|RoomHistoryEnvelope;if(value.format!==ROOM_STORAGE_FORMAT){if(value.format!==undefined&&value.format!=='Pbe'&&value.format!=='Arcade')throw new Error('Unsupported stored room format.');return {value:value as Room,revision:row.revision};}
 const envelope=value as RoomHistoryEnvelope,m=envelope.manifest;if(!isRoomManifest(m)||m.orgId!==org||m.id!==id||m.seasonId!==row.season_id||m.revision!==row.revision)throw new Error('Stored room history scope conflict.');
 validateManifest(m);
 const nodes=new Map<string,string>(),queued=new Set(manifestRefs(m).map(ref=>ref.hash)),pending=[...queued];
 // Read only this manifest's closure, in bounded sets; orphaned historical nodes never enter memory.
 for(let offset=0;offset<pending.length;){
  const hashes=pending.slice(offset,offset+32);offset+=hashes.length;const rows=await db.prepare('SELECT hash,data FROM PracticeRoomComponents WHERE org_id=? AND season_id=? AND room_id=? AND hash IN (SELECT value FROM json_each(?))').bind(org,m.seasonId,id,JSON.stringify(hashes)).all<{hash:string;data:string}>();
  if(rows.results.length!==hashes.length)throw new Error('Stored room component is missing or corrupt.');
  for(const row of rows.results){const node=await parseNode(row.hash,row.data);nodes.set(row.hash,row.data);if(node.type==='branch')for(const hash of node.children)if(!queued.has(hash)){queued.add(hash);pending.push(hash);}}
 }
 const room=await new RoomCodec().decode(m,hash=>nodes.get(hash)??null);
 return {value:room,revision:row.revision};
}
