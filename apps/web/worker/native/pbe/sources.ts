import type { RequestContext } from '../types';
import { HttpError } from '../types';
import { effectiveSources, student, scopePacks, memberId } from '../application/model';
import type { Season, Source, Pack, Scope } from '../application/model';
import { guid } from './bank';
import type { BankScope } from './bank';
export interface PbeSource { id:string; contentPackId:string; sourceKind:'Scripture'|'Commentary'; bookKey:string; chapter:number|null; verse:number|null; ordinal:number; citation:string; canonicalText:string }
export interface PbeIntroductionUnit { id:string; citation:string; canonicalText:string }
export interface PbeIntroduction { id:string; organizationId:string; seasonId:string; bookKey:string; sourceEdition:string; title:string; citation:string; licensingStatus:string; reviewed:boolean; units:PbeIntroductionUnit[] }
export interface PbeIntroductionAssignment { id:string; seasonId:string; contentPackId:string; studentUserId:string }
export const introductionLicensed=(status:string)=>['approved','public-domain','creative-commons'].includes(status);
export type PbeGuard={kind:string;id:string;revision:number};
export async function introductionRows(ctx:RequestContext,seasonId:string){
 const result=[] as {value:PbeIntroduction;revision:number}[];
 let after='';for(;;){const page=await ctx.env.DB.prepare("SELECT id,data,revision FROM Records INDEXED BY Records_training_scope WHERE org_id=? AND season_id=? AND owner_id IS NULL AND kind='pbe-introduction' AND id>? ORDER BY id LIMIT 1000").bind(ctx.orgId,seasonId,after).all<{id:string;data:string;revision:number}>();result.push(...page.results.map(r=>({value:JSON.parse(r.data) as PbeIntroduction,revision:r.revision})));if(page.results.length<1000)break;after=page.results.at(-1)!.id;}return result;
}
/** Private source view. Request IDs restrict scope and never confer permission. */
export async function resolvePbeSources(ctx:RequestContext,scope:Omit<BankScope,'sourceUnitIds'>):Promise<{sources:PbeSource[];fingerprint:string;guards:PbeGuard[];selectedBookKeys:string[]}> {
 const organizationId=guid(scope.organizationId),seasonId=guid(scope.seasonId),studentId=scope.studentId===undefined?undefined:guid(scope.studentId);
 if(organizationId!==ctx.orgId||ctx.actor.organizationId!==ctx.orgId)throw new HttpError(403,'Organization access denied.');
 const actor=await ctx.env.DB.prepare('SELECT active,kind,role FROM Users WHERE id=? AND org_id=?').bind(ctx.actor.userId,organizationId).first<{active:number;kind:string;role:string}>();
 if(!actor?.active)throw new HttpError(403,'Active membership required.');
 if(actor.kind==='Student'&&(actor.role!=='Student'||studentId!==ctx.actor.userId))throw new HttpError(403,'Only your own assigned bank is available.');
 if(actor.kind!=='Student'&&(actor.kind!=='Adult'||!['Owner','Admin'].includes(actor.role)))throw new HttpError(403,'Access denied.');
 const season=await ctx.store.require<Season>('season',seasonId,organizationId);
 if(season.value.organizationId!==organizationId||season.value.status!=='Active')throw new HttpError(400,'Choose an active season.');
 if(studentId){if(!season.value.pbeEnabled)throw new HttpError(403,'PBE training is not enabled for this season.');if(!(await student(ctx,studentId)).isActive)throw new HttpError(403,'Active student required.');}
 const legacy=await effectiveSources(ctx,seasonId,studentId);
 const packs=await ctx.store.getMany<Pack>('pack',[...new Set(legacy.map(s=>s.contentPackId))],organizationId);
 const revisions=await ctx.env.DB.prepare("SELECT kind,id,revision,data FROM Records INDEXED BY Records_scope WHERE org_id=? AND kind='scope' AND id=? UNION ALL SELECT kind,id,revision,data FROM Records INDEXED BY Records_training_scope WHERE org_id=? AND season_id=? AND owner_id=? AND kind IN ('assignment','pbe-introduction-assignment') ORDER BY kind,id").bind(organizationId,seasonId,organizationId,seasonId,studentId??'').all<{kind:string;id:string;revision:number;data:string}>();
 const sourceRecords=await ctx.store.getMany<Source>('source',legacy.map(s=>s.id),organizationId);
 const intros=await introductionRows(ctx,seasonId),storedScope=revisions.results.find(r=>r.kind==='scope');
 const books=new Set(storedScope?scopePacks(JSON.parse(storedScope.data) as Scope).flatMap(p=>p.includes.map(r=>r.bookKey.toUpperCase())):[]);
 const membership=studentId?await ctx.store.get('membership',memberId(seasonId,studentId),organizationId):null;
 const assigned=new Set(revisions.results.filter(r=>r.kind==='pbe-introduction-assignment').map(r=>(JSON.parse(r.data) as PbeIntroductionAssignment).contentPackId));
 const sources:PbeSource[]=legacy.map(s=>({id:s.id,contentPackId:s.contentPackId,bookKey:s.bookKey,chapter:s.chapter,verse:s.verse,ordinal:s.ordinal,citation:s.citation,canonicalText:s.canonicalText,sourceKind:packs.find(p=>p.value.id===s.contentPackId)?.value.sourceType==='Scripture'?'Scripture':'Commentary'}));
 for(const {value:p} of intros)if(p.organizationId===organizationId&&p.seasonId===seasonId&&p.reviewed&&introductionLicensed(p.licensingStatus)&&books.has(p.bookKey)&&(!studentId||membership&&assigned.has(p.id)))sources.push(...p.units.map((u,i)=>({...u,contentPackId:p.id,sourceKind:'Commentary' as const,bookKey:p.bookKey,chapter:null,verse:null,ordinal:i+1})));
 const guards=[{kind:'season',id:seasonId,revision:season.revision},...revisions.results.map(({kind,id,revision})=>({kind,id,revision})),...packs.map(p=>({kind:'pack',id:p.value.id,revision:p.revision})),...sourceRecords.map(s=>({kind:'source',id:s.value.id,revision:s.revision})),...intros.map(p=>({kind:'pbe-introduction',id:p.value.id,revision:p.revision})),...(membership?[{kind:'membership',id:memberId(seasonId,studentId!),revision:membership.revision}]:[]),{kind:actor.kind==='Student'?'@active-user':'@active-admin',id:ctx.actor.userId,revision:0},...(studentId?[{kind:'@active-user',id:studentId,revision:0}]:[])];
 return {sources,guards,selectedBookKeys:[...books].sort(),fingerprint:JSON.stringify([season,actor,sources,packs,revisions.results,intros,[...books].sort(),membership,guards])};
}
