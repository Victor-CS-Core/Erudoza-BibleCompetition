import type { RequestContext } from '../types';
import { HttpError } from '../types';
import { resolvePbeSources } from './sources';
import type { PbeSource } from './sources';
export { resolvePbeSources } from './sources';
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
export async function sourceProof(question:PbeQuestion,sources:Map<string,Pick<PbeSource,'id'|'canonicalText'|'citation'>>):Promise<string>{
 const selected=question.sourceUnitIds.map(id=>sources.get(id));
 if(selected.some(s=>!s))throw new HttpError(400,'Question source is outside the approved scope.');
 const units=selected as Pick<PbeSource,'id'|'canonicalText'|'citation'>[];
 if(normalizeEvidence(question.reference)!==normalizeEvidence(units.map(s=>s.citation).join('; '))||!normalizeEvidence(units.map(s=>s.canonicalText).join('\n')).includes(normalizeEvidence(question.evidence)))throw new HttpError(400,'Reference and evidence must match the declared canonical sources.');
 const material=units.flatMap(s=>[s.id,s.canonicalText,s.citation]).map(v=>`${v.length}:${v}`).join('');
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(material)));return [...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export async function loadPbeBank(ctx:RequestContext,scope:BankScope):Promise<PbeBank>{
 if(!Array.isArray(scope.sourceUnitIds))throw new HttpError(400,'Provide source IDs.');
 return loadFromResolvedSources(ctx,scope,await resolvePbeSources(ctx,scope));
}
/** Metadata uses the same freshly authorized snapshot and final recheck as private selection. */
export async function loadPbeBankMetadata(ctx:RequestContext,scope:Omit<BankScope,'sourceUnitIds'>){
 const initial=await resolvePbeSources(ctx,scope);
 const bank=await loadFromResolvedSources(ctx,{...scope,sourceUnitIds:initial.sources.map(s=>s.id)},initial);
 return {questionCount:bank.questions.length,targetCount:bank.targets.length,sourceUnitCount:initial.sources.length,missingSourceUnitIds:bank.missingSourceUnitIds,...(scope.studentId?{}:{uncoveredTargets:bank.targets.filter(t=>!bank.questions.some(q=>q.parts.some(p=>p.targetId===t.id))).length,singleVariantTargets:bank.targets.filter(t=>bank.questions.filter(q=>q.parts.some(p=>p.targetId===t.id)).length===1).length})};
}
async function loadFromResolvedSources(ctx:RequestContext,scope:BankScope,initial:Awaited<ReturnType<typeof resolvePbeSources>>):Promise<PbeBank>{
 const restriction=new Set(scope.sourceUnitIds.map(guid));
 const allowed=initial.sources.filter(s=>restriction.has(s.id));
 const records:PbeQuestionRecord[]=[],targets:PbeTarget[]=[];
 // Keyset pagination stays on the tenant/season index and never touches student history.
 for(const kind of ['pbe-question-head','pbe-target']){
  let after='';for(;;){const page=await ctx.env.DB.prepare("SELECT id,data FROM Records INDEXED BY Records_training_scope WHERE org_id=? AND season_id=? AND owner_id IN (SELECT value FROM json_each(?)) AND kind=? AND id>? ORDER BY id LIMIT 1000").bind(ctx.orgId,guid(scope.seasonId),JSON.stringify(allowed.map(s=>s.id)),kind,after).all<{id:string;data:string}>();
   for(const stored of page.results){const row=JSON.parse(stored.data) as PbeQuestionRecord|PbeTarget;if(kind==='pbe-target')targets.push(row as PbeTarget);else if((row as PbeQuestionRecord).published)records.push(row as PbeQuestionRecord);}
   if(page.results.length<1000)break;after=page.results.at(-1)!.id;
  }
 }
 const sourceMap=new Map(initial.sources.map(s=>[s.id,s]));
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
 result.questions=result.questions.filter(q=>q.sourceUnitIds.every(id=>{const s=sourceMap.get(id);return s&&s.contentPackId===q.contentPackId&&s.sourceKind===q.sourceKind;}));
 const covered=new Set(result.questions.flatMap(q=>q.sourceUnitIds));result.missingSourceUnitIds=allowed.map(s=>s.id).filter(id=>!covered.has(id)).sort();
 if((await resolvePbeSources(ctx,scope)).fingerprint!==initial.fingerprint)throw new HttpError(409,'The PBE scope changed. Refresh and retry.');
 return result;
}
