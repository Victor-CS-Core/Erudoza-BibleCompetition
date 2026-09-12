import { DurableObject } from 'cloudflare:workers';
import { authenticate, checkOrigin } from '../auth';
import { Store } from '../store';
import { body, HttpError, json, requiredString, type Actor, type Env, type RequestContext } from '../types';
import { acknowledgePresentation, type PresentationState } from './presentation';
import { submitTimedPbeSession, type PbeSession } from './sessions';

interface FrozenSubmission { input: { clientSubmissionId:string; challengeCardId:string; answers:string[]; hintsUsed:false }; retryAnswers:string[]; elapsedMs:number; lockedAtMs:number }
interface SoloState extends PresentationState {
  sessionId:string;
  epoch:string;
  status:'Presenting'|'Armed'|'Settling'|'Settled'|'Interrupted';
  points:number;
  draft:{answers:string[];elapsedMs:number;lockedAtMs:number}|null;
  frozen:FrozenSubmission|null;
  actor:Actor;
  response?:unknown;
}
type Input = { action?:string; questionId?:string; revision?:number; delivery?:PresentationState['delivery']; answers?:string[]; clientSubmissionId?:string };

/** Per-session authority. Persistent state is created only after authentication and saved-session ownership checks. */
export class PbeSoloRound extends DurableObject<Env> {
  private readonly epoch=crypto.randomUUID();
  private tail:Promise<unknown>=Promise.resolve();
  private keepAlive:ReturnType<typeof setInterval>|undefined;
  constructor(ctx:DurableObjectState,env:Env){super(ctx,env);ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL)');}
  private load():SoloState|null {const row=this.ctx.storage.sql.exec<{data:string}>('SELECT data FROM state WHERE id=1').toArray()[0];return row?JSON.parse(row.data) as SoloState:null;}
  private save(state:SoloState){this.ctx.storage.sql.exec('INSERT INTO state(id,data) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',JSON.stringify(state));if(state.status==='Armed'&&!this.keepAlive)this.keepAlive=setInterval(()=>{},30000);if(state.status!=='Armed'&&this.keepAlive){clearInterval(this.keepAlive);this.keepAlive=undefined;}}
  private async serialize<T>(fn:()=>Promise<T>){const before=this.tail;let release!:()=>void;this.tail=new Promise<void>(r=>release=r);await before;try{return await fn();}finally{release();}}
  private context(request:Request,actor:Actor):RequestContext {return {request,env:this.env,actor,orgId:actor.organizationId,path:new URL(request.url).pathname,store:new Store(this.env.DB)};}
  private async session(actor:Actor,id:string){const row=await new Store(this.env.DB).get<PbeSession>('pbe-session',id,actor.organizationId);if(!row||row.value.studentUserId!==actor.userId||row.value.mode!=='Simulation')throw new HttpError(404,'Timed rehearsal was not found.');return row.value;}
  private view(state:SoloState){return {questionId:state.questionId,revision:state.revision,delivery:state.delivery,requiredScribeIds:state.requiredScribeIds,readyScribeIds:state.readyScribeIds,responseStartsAtMs:state.responseStartsAtMs,responseEndsAtMs:state.responseEndsAtMs,status:state.status,serverNow:new Date().toISOString(),feedbackDeferred:true};}
  private recover(state:SoloState){if(state.epoch===this.epoch)return false;state.epoch=this.epoch;if(state.status==='Armed')state.status=state.frozen||state.draft?'Settling':'Interrupted';else if(state.status==='Presenting'){state.revision++;state.readyScribeIds=[];state.responseStartsAtMs=null;state.responseEndsAtMs=null;}this.save(state);return state.status==='Interrupted';}
  private async recordInterruption(state:SoloState){const store=new Store(this.env.DB),prior=await store.get('pbe-solo-interruption',state.sessionId,state.actor.organizationId);if(!prior)await store.insert('pbe-solo-interruption',state.sessionId,state.actor.organizationId,{sessionId:state.sessionId,questionId:state.questionId,status:'Interrupted',restartAllowed:true},{ownerId:state.actor.userId});}
  private async settle(state:SoloState,request:Request){
    if(state.status==='Settled')return {...state.response as Record<string,unknown>,alreadyProcessed:true};
    const frozen=state.frozen;if(!frozen)throw new HttpError(409,state.status==='Interrupted'?'This rehearsal was interrupted. Start another shortened timed practice.':'No frozen answer is ready.');
    state.status='Settling';this.save(state);
    const response=await submitTimedPbeSession(this.context(request,state.actor),state.sessionId,frozen.input,frozen.elapsedMs,frozen.lockedAtMs);
    if(!response)throw new HttpError(404,'Timed rehearsal was not found.');
    if(!response.ok)return response;
    state.response=await response.json();state.status='Settled';this.save(state);return state.response;
  }
  async fetch(request:Request):Promise<Response>{
    try{
      const match=new URL(request.url).pathname.match(/^\/api\/v1\/study\/sessions\/([a-f0-9-]{36})\/timed$/i);if(!match)throw new HttpError(404,'Timed rehearsal route not found.');
      const input=request.method==='POST'?await body<Input>(request,32768):null;
      const ingress=Date.now();
      return await this.serialize(async()=>{
        checkOrigin(request,this.env);const actor=await authenticate(request,this.env);const session=await this.session(actor,match[1]);let state=this.load();if(state&&this.recover(state))await this.recordInterruption(state);
        if(request.method==='GET'&&state)return json(this.view(state));
        if(input?.action==='submit'&&state&&(state.status==='Settling'||state.status==='Settled')){
          const frozen=state.frozen;if(!frozen||input.clientSubmissionId!==frozen.input.clientSubmissionId||input.questionId!==state.questionId||input.revision!==state.revision||!Array.isArray(input.answers)||JSON.stringify(input.answers)!==JSON.stringify(frozen.retryAnswers))throw new HttpError(409,'The frozen response has another submission payload.');
          const settled=await this.settle(state,request);return settled instanceof Response?settled:json(settled);
        }
        const card=session.cards[session.attempts.length];if(!card||card.servedAtMs===null)throw new HttpError(409,'Choose the active saved card.');
        if(request.method==='GET')return json(state?this.view(state):{status:'NotPresented',questionId:card.id,revision:0,serverNow:new Date().toISOString(),feedbackDeferred:true});
        if(!input||typeof input.action!=='string')throw new HttpError(400,'Choose a timed rehearsal action.');
        if(!state||state.questionId!==card.id){if(input.action!=='present')throw new HttpError(409,'Present the active question first.');const points=card.question.parts.reduce((n,p)=>n+p.points,0);state={sessionId:session.id,questionId:card.id,revision:1,delivery:input.delivery==='TextFallback'?'TextFallback':'Audio',requiredScribeIds:[actor.userId],readyScribeIds:[],responseStartsAtMs:null,responseEndsAtMs:null,epoch:this.epoch,status:'Presenting',points,draft:null,frozen:null,actor};this.save(state);return json(this.view(state));}
        if(state.status==='Interrupted')throw new HttpError(409,'This rehearsal was interrupted. Start another shortened timed practice.');
        if(input.questionId!==state.questionId||input.revision!==state.revision)throw new HttpError(409,'This action is for another presentation revision.');
        if(input.action==='ack'){
          if(input.delivery!==state.delivery)throw new HttpError(400,'Confirm the saved presentation delivery.');
          const updated=acknowledgePresentation(state,actor.userId,state.questionId,ingress,state.points);state={...state,...updated,status:updated.responseStartsAtMs===null?'Presenting':'Armed'};this.save(state);if(state.responseEndsAtMs)await this.ctx.storage.setAlarm(state.responseEndsAtMs);return json(this.view(state));
        }
        if(!['draft','submit'].includes(input.action)||!Array.isArray(input.answers)||input.answers.length!==card.question.parts.length||input.answers.some(a=>typeof a!=='string'||a.length>10000))throw new HttpError(400,'Provide one text answer per requested part.');
        if(state.status!=='Armed'||state.responseStartsAtMs===null||state.responseEndsAtMs===null||ingress<state.responseStartsAtMs)throw new HttpError(409,'The response window has not opened.');
        if(input.action==='draft'){if(ingress<=state.responseEndsAtMs){state.draft={answers:[...input.answers],elapsedMs:ingress-state.responseStartsAtMs,lockedAtMs:ingress};this.save(state);}return json(this.view(state));}
        const timely=ingress<=state.responseEndsAtMs,draft=!timely?state.draft:null;
        const answers=timely?[...input.answers]:draft?[...draft.answers]:card.question.parts.map(()=> '');
        const elapsedMs=draft?.elapsedMs??Math.max(0,ingress-state.responseStartsAtMs),lockedAtMs=draft?.lockedAtMs??ingress;state.frozen={input:{clientSubmissionId:requiredString(input.clientSubmissionId,'Submission ID',200),challengeCardId:card.id,answers,hintsUsed:false},retryAnswers:[...input.answers],elapsedMs,lockedAtMs};state.status='Settling';this.save(state);
        const settled=await this.settle(state,request);return settled instanceof Response?settled:json(settled);
      });
    }catch(error){if(error instanceof HttpError)return json({title:error.message,detail:error.message},error.status);console.error('PBE solo authority failed',error instanceof Error?error.name:'UnknownError');return json({title:'Timed rehearsal temporarily unavailable'},503);}
  }
  async alarm(){await this.serialize(async()=>{const state=this.load();if(!state)return;if(this.recover(state)){await this.recordInterruption(state);return;}if(state.status!=='Armed'||state.responseEndsAtMs===null)return;const session=await this.session(state.actor,state.sessionId),card=session.cards[session.attempts.length];if(!card||card.id!==state.questionId){state.status='Interrupted';this.save(state);return;}const answers=state.draft?[...state.draft.answers]:card.question.parts.map(()=>'');state.frozen={input:{clientSubmissionId:crypto.randomUUID(),challengeCardId:card.id,answers,hintsUsed:false},retryAnswers:[...answers],elapsedMs:state.draft?.elapsedMs??state.responseEndsAtMs-state.responseStartsAtMs!,lockedAtMs:state.draft?.lockedAtMs??state.responseEndsAtMs};state.status='Settling';this.save(state);const request=new Request(`https://internal/api/v1/study/sessions/${state.sessionId}/timed`);await this.settle(state,request);});}
}
