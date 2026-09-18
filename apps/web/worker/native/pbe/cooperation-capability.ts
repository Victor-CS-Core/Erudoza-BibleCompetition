import type {RequestContext} from '../types';
import {HttpError,admin} from '../types';
import {guid} from './bank';
import type {InputGuard} from './chapter-manifest';
import {cooperationPage,cooperationTooLarge,type RosterMember,type CooperationReason} from './cooperation-storage';
export type CooperationOperation='StudentSummary'|'CoachSummary'|'CoachDetail'|'StudentContinue'|'CoachContinue';
const verified=Symbol('verified-cooperation');
export class VerifiedCooperationScope {
 private readonly token=verified;
 private constructor(readonly ctx:RequestContext,readonly seasonId:string,readonly operation:CooperationOperation,readonly reason:CooperationReason,readonly guards:InputGuard[]){}
 assertSubject(studentId:string,roster:RosterMember[]){if(this.token!==verified||!roster.some(r=>r.studentId===studentId))throw new HttpError(403,'Student is outside this cooperation roster.');}
 static async create(ctx:RequestContext,seasonInput:string,operation:CooperationOperation){
  const seasonId=guid(seasonInput);
  if(ctx.orgId!==ctx.actor.organizationId)throw new HttpError(403,'Organization access denied.');
  const actor=await ctx.env.DB.prepare('SELECT active,kind,role FROM Users WHERE id=? AND org_id=?').bind(ctx.actor.userId,ctx.orgId).first<{active:number;kind:string;role:string}>();
  if(!actor?.active||actor.kind!==ctx.actor.kind||actor.role!==ctx.actor.role)throw new HttpError(403,'Active account required.');
  if(operation.startsWith('Coach'))admin(ctx.actor);else{
   // Learner parity: Student/Student or Adult Owner/Admin on their own learner view.
   // (The cooperation roster itself stays Students-only; non-roster learners get
   // the team summary with no personal entry.)
   const isLearner=(actor.kind==='Student'&&actor.role==='Student')||(actor.kind==='Adult'&&(actor.role==='Owner'||actor.role==='Admin'));
   if(!isLearner)throw new HttpError(403,'Learner access required.');
  }
  const row=await ctx.env.DB.prepare("SELECT s.revision,json_extract(s.data,'$.organizationId') AS organizationId,json_extract(s.data,'$.status') AS status,json_extract(s.data,'$.pbeEnabled') AS enabled,sc.revision AS scopeRevision FROM Records s LEFT JOIN Records sc ON sc.org_id=s.org_id AND sc.kind='scope' AND sc.id=s.id WHERE s.kind='season' AND s.org_id=? AND s.id=?").bind(ctx.orgId,seasonId).first<{revision:number;organizationId:string;status:string;enabled:number;scopeRevision:number|null}>();
  if(!row)throw new HttpError(404,'Season was not found.');if(row.organizationId!==ctx.orgId)throw new HttpError(403,'Organization access denied.');
  const guards:InputGuard[]=[{kind:'season',id:seasonId,revision:row.revision},{kind:'scope',id:seasonId,revision:row.scopeRevision}];
  if(operation.startsWith('Student')){
   const member=await ctx.env.DB.prepare("SELECT revision FROM Records WHERE kind='membership' AND org_id=? AND season_id=? AND owner_id=? AND id=?").bind(ctx.orgId,seasonId,ctx.actor.userId,`${seasonId}:${ctx.actor.userId}`).first<{revision:number}>();
   if(!member)throw new HttpError(403,'Current season membership required.');
  }
  return new VerifiedCooperationScope(ctx,seasonId,operation,row.status!=='Active'?'SeasonClosed':!row.enabled?'PbeDisabled':null,guards);
 }
}
export const rosterSql=`SELECT u.id AS studentId,u.display_name AS displayName,m.revision AS membershipRevision FROM Users u JOIN Records m ON m.kind='membership' AND m.org_id=u.org_id AND m.season_id=? AND m.owner_id=u.id AND m.id=m.season_id||':'||u.id WHERE u.org_id=? AND u.active=1 AND u.kind='Student' AND u.role='Student'`;
export async function cooperationRoster(scope:VerifiedCooperationScope){
 const {ctx,seasonId}=scope;
 const count=await ctx.env.DB.prepare(`SELECT count(*) AS n FROM (${rosterSql} LIMIT 33)`).bind(seasonId,ctx.orgId).first<{n:number}>();if(count!.n>32)throw cooperationTooLarge();
 const rows=await cooperationPage<RosterMember>(ctx,`SELECT studentId AS key,json_object('studentId',studentId,'displayName',displayName,'membershipRevision',membershipRevision) AS payload FROM (${rosterSql}) ORDER BY studentId LIMIT 33`,[seasonId,ctx.orgId]);if(rows.length!==count!.n)throw cooperationTooLarge(true);return rows;
}
