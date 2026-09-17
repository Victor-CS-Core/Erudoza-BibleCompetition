import type {Env} from '../types';
import {HttpError} from '../types';
import type {RequestContext} from '../types';
import type {Room,Submission} from './state';
import {points} from './scoring';
import {QUEST_DEFS,type QuestKey} from '../training/quests';
import {ROOM_STORAGE_FORMAT,RoomCodec,isRoomManifest,manifestRefs,parseNode,validateManifest,type RoomManifest} from './room-storage';

export type ScoreSubmission=Omit<Submission,'answers'>&{answers?:string[];unanswered?:boolean};
export type RoomStats=Pick<Room,'id'|'orgId'|'seasonId'|'revision'|'format'|'status'|'teamCount'|'teamSize'|'questionCount'|'coached'|'bookKey'|'rules'|'completedAt'|'members'|'contributions'|'simulation'|'services'>&{
 questions:{id:string;version:number;sourceUnitId:string;parts:{points:number}[]}[];submissions:ScoreSubmission[];
};
export interface RoomHistorySummary extends RoomStats {summaryVersion:1}
export interface RoomHistoryEnvelope {format:typeof ROOM_STORAGE_FORMAT;manifest:RoomManifest;summary:RoomHistorySummary}
export function summarizeRoom(r:Room):RoomHistorySummary{
 const {id,orgId,seasonId,revision,format,status,teamCount,teamSize,questionCount,coached,bookKey,rules,completedAt,members,contributions,simulation,services}=r;
 return {summaryVersion:1,id,orgId,seasonId,revision,format,status,teamCount,teamSize,questionCount,coached,bookKey,rules,completedAt,members,contributions,simulation,services,questions:r.questions.map(q=>({id:q.id,version:q.version,sourceUnitId:q.sourceUnitId,parts:q.parts.map(p=>({points:p.points}))})),submissions:r.submissions.map(({answers,...s})=>({...s,unanswered:answers.every(a=>!a.trim())}))};
}
// Project legacy summaries in SQLite too: answer keys and full answers never enter a bootstrap collection.
const fields=['id','orgId','seasonId','revision','format','status','teamCount','teamSize','questionCount','coached','bookKey','rules','completedAt','members','contributions','simulation','services'];
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

/** Single-room summary projection for the room recap endpoint (no component hydration). */
export async function readRoomSummary(db:Env['DB'],org:string,id:string):Promise<RoomHistorySummary|null>{
 const row=await db.prepare(`SELECT CASE WHEN json_extract(r.data,'$.format')=? THEN json_extract(r.data,'$.summary') ELSE ${legacySummary} END AS data FROM Records r WHERE kind='match' AND org_id=? AND id=?`).bind(ROOM_STORAGE_FORMAT,org,id).first<{data:string|null}>();
 if(!row?.data)return null;
 return JSON.parse(row.data) as RoomHistorySummary;
}

/**
 * Room-participation record written by the room-completion hook
 * (kind `room-participation`, id `${roomId}:${userId}`). Holds the room's
 * gamification credit for one learner. May be absent for rooms completed
 * before the hook shipped; the recap then reports XP as untracked.
 */
export interface RoomParticipation {
 roomId:string;userId:string;seasonId:string;format:'Arcade'|'Pbe';
 simulation:boolean;completedAtUtc:string;questionsAnswered:number;
 xpAwarded:number;dayCredited:boolean;questsCompleted:string[];
}

export interface RoomRecapQuest {key:string;title:string}
export interface RoomRecap {
 roomId:string;seasonId:string;format:'Arcade'|'Pbe';status:string;
 completedAtUtc:string|null;teamCount:1|2;simulation:boolean;questionCount:number;
 myTeam:number;
 teamScore:{accuracyHundredths:number;speedHundredths:number;availableHundredths:number};
 contributions:{questionsAnswered:number;accuracyHundredths:number};
 /** `tracked:false` (earned:null) means the room predates room XP tracking. */
 xp:{earned:number|null;tracked:boolean};
 dayCredited:boolean;
 questsCompleted:RoomRecapQuest[];
 /** The learner's team milestones for the room's season (not room-attributable). */
 awards:{key:string;title:string}[];
}

/**
 * Build the completed-room recap for the requesting learner.
 * Returns null when the room is missing or the requester is not a member;
 * throws 409 when the room has not completed.
 */
export async function buildRoomRecap(ctx:RequestContext,roomId:string):Promise<RoomRecap|null>{
 const summary=await readRoomSummary(ctx.env.DB,ctx.orgId,roomId);
 if(!summary)return null;
 const member=summary.members.find(m=>m.userId===ctx.actor.userId);
 if(!member)return null;
 if(summary.status!=='Completed')throw new HttpError(409,'This room has not completed yet.');
 const participation=await ctx.store.get<RoomParticipation>('room-participation',`${roomId}:${ctx.actor.userId}`,ctx.orgId);
 const record=participation?.value??null;
 const availableByQuestion=new Map(summary.questions.map(q=>[q.id,points(q)*100]));
 const teamSubmissions=summary.submissions.filter(s=>s.team===member.team);
 const teamScore={
  accuracyHundredths:teamSubmissions.reduce((n,s)=>n+s.accuracyHundredths,0),
  speedHundredths:teamSubmissions.reduce((n,s)=>n+s.speedHundredths,0),
  availableHundredths:teamSubmissions.reduce((n,s)=>n+(availableByQuestion.get(s.questionId)??0),0),
 };
 const mySubmissions=summary.submissions.filter(s=>s.scribeId===ctx.actor.userId&&!s.deadlineDraft);
 const awards=(await ctx.store.list<{key:string;title:string;seasonId:string;userId:string}>('award',ctx.orgId))
  .filter(a=>a.userId===ctx.actor.userId&&a.seasonId===summary.seasonId)
  .map(a=>({key:a.key,title:a.title}));
 const questKey=(key:string):key is QuestKey=>key in QUEST_DEFS;
 return {
  roomId:summary.id,seasonId:summary.seasonId,format:summary.format??'Arcade',status:summary.status,
  completedAtUtc:summary.completedAt??null,teamCount:summary.teamCount??2,simulation:!!summary.simulation,
  questionCount:summary.questionCount,myTeam:member.team,teamScore,
  contributions:{questionsAnswered:mySubmissions.length,accuracyHundredths:mySubmissions.reduce((n,s)=>n+s.accuracyHundredths,0)},
  xp:record?{earned:record.xpAwarded,tracked:true}:{earned:null,tracked:false},
  dayCredited:record?.dayCredited??false,
  questsCompleted:(record?.questsCompleted??[]).filter(questKey).map(key=>({key,title:QUEST_DEFS[key].title})),
  awards,
 };
}
