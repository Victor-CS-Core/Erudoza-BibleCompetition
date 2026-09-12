import type { RequestContext } from '../types';
import { HttpError } from '../types';
import { effectiveSources, student } from '../application/model';
import type { Season, Source, Pack } from '../application/model';
import { validatePbeQuestion } from './grading';
import type { PbeQuestion, PbeTarget } from './types';
export interface BankScope { organizationId:string; seasonId:string; studentId?:string; sourceUnitIds:string[] }
export interface PbeBank { questions:PbeQuestion[]; targets:PbeTarget[]; missingSourceUnitIds:string[] }
export interface PbeQuestionRecord { id:string; seasonId:string; published:boolean; sourceFingerprint:string; question:PbeQuestion }
export const guid=(value:unknown):string=>{if(typeof value!=='string'||! /^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))throw new HttpError(400,'Provide a valid nonempty GUID.');return value.toLowerCase();};
export function filterPbeBank(questions:PbeQuestion[],targets:PbeTarget[],allowedSourceUnitIds:string[]):PbeBank {
 const allowed=new Set(allowedSourceUnitIds.map(guid));
 const eligibleTargets=targets.filter(t=>t.sourceUnitIds.every(id=>allowed.has(guid(id))));
 const latest=new Map<string,PbeQuestion>();for(const q of questions)if((latest.get(guid(q.id))?.version??0)<q.version)latest.set(guid(q.id),q);
 const eligible=[...latest.values()].filter(q=>q.sourceUnitIds.every(id=>allowed.has(guid(id))));
 const covered=new Set(eligible.flatMap(q=>q.sourceUnitIds.map(guid)));
 return {questions:eligible.sort((a,b)=>a.id.localeCompare(b.id)),targets:eligibleTargets,missingSourceUnitIds:[...allowed].filter(id=>!covered.has(id)).sort()};
}
const normalizeEvidence=(value:string)=>value.normalize('NFC').replace(/[ \t\r\n\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+/g,' ').trim();
export async function sourceProof(question:PbeQuestion,sources:Map<string,Source>):Promise<string>{
 const selected=question.sourceUnitIds.map(id=>sources.get(id));
 if(selected.some(s=>!s))throw new HttpError(400,'Question source is outside the approved scope.');
 const units=selected as Source[];
 if(normalizeEvidence(question.reference)!==normalizeEvidence(units.map(s=>s.citation).join('; '))||!normalizeEvidence(units.map(s=>s.canonicalText).join('\n')).includes(normalizeEvidence(question.evidence)))throw new HttpError(400,'Reference and evidence must match the declared canonical sources.');
 const material=units.flatMap(s=>[s.id,s.canonicalText,s.citation]).map(v=>`${v.length}:${v}`).join('');
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(material)));return [...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
}
/** This is server-only. Caller IDs restrict, but never grant, an effective scope. */
export async function resolvePbeSources(ctx:RequestContext,scope:Omit<BankScope,'sourceUnitIds'>):Promise<{sources:Source[];fingerprint:string;guards:{kind:string;id:string;revision:number}[]}> {
 const organizationId=guid(scope.organizationId),seasonId=guid(scope.seasonId),studentId=scope.studentId===undefined?undefined:guid(scope.studentId);
 if(organizationId!==ctx.orgId||ctx.actor.organizationId!==ctx.orgId)throw new HttpError(403,'Organization access denied.');
 const actor=await ctx.env.DB.prepare('SELECT active,kind,role FROM Users WHERE id=? AND org_id=?').bind(ctx.actor.userId,organizationId).first<{active:number;kind:string;role:string}>();
 if(!actor?.active)throw new HttpError(403,'Active membership required.');
 if(actor.kind==='Student'&&(actor.role!=='Student'||studentId!==ctx.actor.userId))throw new HttpError(403,'Only your own assigned bank is available.');
 if(actor.kind!=='Student'&&(actor.kind!=='Adult'||!['Owner','Admin'].includes(actor.role)))throw new HttpError(403,'Access denied.');
 const season=await ctx.store.require<Season>('season',seasonId,organizationId);
 if(season.value.organizationId!==organizationId||season.value.status!=='Active')throw new HttpError(400,'Choose an active season.');
 if(studentId){if(!season.value.pbeEnabled)throw new HttpError(403,'PBE training is not enabled for this season.');if(!(await student(ctx,studentId)).isActive)throw new HttpError(403,'Active student required.');}
 const sources=await effectiveSources(ctx,seasonId,studentId);
 const packs=await ctx.store.getMany<Pack>('pack',[...new Set(sources.map(s=>s.contentPackId))],organizationId);
 const revisions=await ctx.env.DB.prepare("SELECT kind,id,revision,data FROM Records INDEXED BY Records_scope WHERE org_id=? AND kind='scope' AND id=? UNION ALL SELECT kind,id,revision,data FROM Records INDEXED BY Records_training_scope WHERE org_id=? AND season_id=? AND owner_id=? AND kind='assignment' ORDER BY kind,id").bind(organizationId,seasonId,organizationId,seasonId,studentId??'').all<{kind:string;id:string;revision:number;data:string}>();
 const sourceRecords=await ctx.store.getMany<Source>('source',sources.map(s=>s.id),organizationId);
 const guards=[{kind:'season',id:seasonId,revision:season.revision},...revisions.results.map(({kind,id,revision})=>({kind,id,revision})),...packs.map(p=>({kind:'pack',id:p.value.id,revision:p.revision})),...sourceRecords.map(s=>({kind:'source',id:s.value.id,revision:s.revision}))];
 return {sources,guards,fingerprint:JSON.stringify([season,actor,sources,packs,revisions.results,guards])};
}
export async function loadPbeBank(ctx:RequestContext,scope:BankScope):Promise<PbeBank>{
 if(!Array.isArray(scope.sourceUnitIds))throw new HttpError(400,'Provide source IDs.');
 const restriction=new Set(scope.sourceUnitIds.map(guid)),initial=await resolvePbeSources(ctx,scope);
 const allowed=initial.sources.filter(s=>restriction.has(s.id));
 const records:PbeQuestionRecord[]=[],targets:PbeTarget[]=[];
 // Keyset pagination stays on the tenant/season index and never touches student history.
 for(const kind of ['pbe-question-head','pbe-target']){
  let after='';for(;;){const page=await ctx.env.DB.prepare("SELECT id,data FROM Records INDEXED BY Records_training_scope WHERE org_id=? AND season_id=? AND owner_id IN (SELECT value FROM json_each(?)) AND kind=? AND id>? ORDER BY id LIMIT 1000").bind(ctx.orgId,guid(scope.seasonId),JSON.stringify(allowed.map(s=>s.id)),kind,after).all<{id:string;data:string}>();
   for(const stored of page.results){const row=JSON.parse(stored.data) as PbeQuestionRecord|PbeTarget;if(kind==='pbe-target')targets.push(row as PbeTarget);else if((row as PbeQuestionRecord).published)records.push(row as PbeQuestionRecord);}
   if(page.results.length<1000)break;after=page.results.at(-1)!.id;
  }
 }
 const sourceMap=new Map(initial.sources.map(s=>[s.id,s])),packs=new Map((await ctx.store.getMany<Pack>('pack',[...new Set(initial.sources.map(s=>s.contentPackId))],ctx.orgId)).map(p=>[p.value.id,p.value]));
 const valid: PbeQuestion[]=[],targetMap=new Map(targets.map(t=>[t.id,t]));
 const newest=new Map<string,number>();for(const row of records)newest.set(row.question.id,Math.max(newest.get(row.question.id)??0,row.question.version));
 for(const row of records){if(row.question.version!==newest.get(row.question.id))continue;if(row.seasonId!==guid(scope.seasonId))continue;const q=row.question;
  if(q.schemaVersion!==2)continue;
  const referenced=[...new Set(q.parts.map(p=>p.targetId))].flatMap(id=>targetMap.has(id)?[targetMap.get(id)!]:[]);
  try{validatePbeQuestion(q,referenced);}catch{continue;}
  // Do not prefilter source scope here: a newer published out-of-scope version must supersede its predecessor.
  if(q.sourceUnitIds.every(id=>sourceMap.has(id))){try{if(await sourceProof(q,sourceMap)!==row.sourceFingerprint)continue;}catch{continue;}}
  valid.push(q);
 }
 const result=filterPbeBank(valid,targets,allowed.map(s=>s.id));
 result.questions=result.questions.filter(q=>q.sourceUnitIds.every(id=>{const s=sourceMap.get(id);return s&&s.contentPackId===q.contentPackId&&packs.get(s.contentPackId)?.sourceType===(q.sourceKind==='Scripture'?'Scripture':'Supplemental');}));
 const covered=new Set(result.questions.flatMap(q=>q.sourceUnitIds));result.missingSourceUnitIds=allowed.map(s=>s.id).filter(id=>!covered.has(id)).sort();
 if((await resolvePbeSources(ctx,scope)).fingerprint!==initial.fingerprint)throw new HttpError(409,'The PBE scope changed. Refresh and retry.');
 return result;
}
