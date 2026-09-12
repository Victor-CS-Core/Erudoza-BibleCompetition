import { DurableObject } from 'cloudflare:workers';
import { authenticate, checkOrigin } from '../auth';
import { Store } from '../store';
import { body, HttpError, json, requiredString, type Actor, type Env, type RequestContext } from '../types';
import { acknowledgePresentation, type PresentationState } from './presentation';
import { pbeSummary, submitTimedPbeSession, type PbeSession } from './sessions';

interface SubmissionInput { clientSubmissionId:string;challengeCardId:string;answers:string[];hintsUsed:false }
interface FrozenSubmission { input:SubmissionInput;retryAnswers:string[];elapsedMs:number;lockedAtMs:number }
interface HistoryEntry { questionId:string;revision:number;frozen:FrozenSubmission;response:unknown }
interface SoloState extends PresentationState {
  sessionId:string;epoch:string;status:'Presenting'|'Armed'|'Settling'|'Settled'|'Interrupted';points:number;
  draft:{answers:string[];elapsedMs:number;lockedAtMs:number}|null;frozen:FrozenSubmission|null;actor:Actor;response?:unknown;history:HistoryEntry[];
}
type Input={action?:string;questionId?:string;revision?:number;delivery?:PresentationState['delivery'];answers?:string[];clientSubmissionId?:string};

/** Per-session authority. Persistent state is created only after authentication and saved-session ownership checks. */
export class PbeSoloRound extends DurableObject<Env>{
  private readonly epoch=crypto.randomUUID();
  private tail:Promise<unknown>=Promise.resolve();
  private pending=0;
  constructor(ctx:DurableObjectState,env:Env){super(ctx,env);ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL)');}
  private load():SoloState|null{
    const row=this.ctx.storage.sql.exec<{data:string}>('SELECT data FROM state WHERE id=1').toArray()[0];
    if(!row)return null;
    const state=JSON.parse(row.data) as SoloState;state.history??=[];return state;
  }
  private save(state:SoloState){this.ctx.storage.sql.exec('INSERT INTO state(id,data) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',JSON.stringify(state));}
  private async serialize<T>(fn:()=>Promise<T>){
    if(this.pending>=32)throw new HttpError(429,'Too many pending timed rehearsal commands.');
    this.pending++;const before=this.tail;let release!:()=>void;this.tail=new Promise<void>(resolve=>release=resolve);
    await before;try{return await fn();}finally{this.pending--;release();}
  }
  private context(request:Request,actor:Actor):RequestContext{return{request,env:this.env,actor,orgId:actor.organizationId,path:new URL(request.url).pathname,store:new Store(this.env.DB)};}
  private async session(actor:Actor,id:string){
    const row=await new Store(this.env.DB).get<PbeSession>('pbe-session',id,actor.organizationId);
    if(!row||row.value.studentUserId!==actor.userId||row.value.mode!=='Simulation')throw new HttpError(404,'Timed rehearsal was not found.');
    return row.value;
  }
  private view(state:SoloState){return{questionId:state.questionId,revision:state.revision,delivery:state.delivery,requiredScribeIds:state.requiredScribeIds,readyScribeIds:state.readyScribeIds,responseStartsAtMs:state.responseStartsAtMs,responseEndsAtMs:state.responseEndsAtMs,status:state.status,serverNow:new Date().toISOString(),feedbackDeferred:true};}
  private freezeDraft(state:SoloState,partCount:number){
    if(state.frozen)return;
    const answers=state.draft?[...state.draft.answers]:Array.from({length:partCount},()=>'');
    state.frozen={input:{clientSubmissionId:crypto.randomUUID(),challengeCardId:state.questionId,answers,hintsUsed:false},retryAnswers:[...answers],elapsedMs:state.draft?.elapsedMs??Math.max(0,state.responseEndsAtMs!-state.responseStartsAtMs!),lockedAtMs:state.draft?.lockedAtMs??state.responseEndsAtMs!};
    state.status='Settling';this.save(state);
  }
  private async recover(state:SoloState,partCount:number){
    if(state.epoch===this.epoch)return;
    state.epoch=this.epoch;
    if(state.status==='Armed'){
      if(state.draft){this.freezeDraft(state,partCount);await this.ctx.storage.setAlarm(Date.now());}
      else{state.status='Interrupted';this.save(state);await this.recordInterruption(state);}
    }else if(state.status==='Settling'){await this.ctx.storage.setAlarm(Date.now());this.save(state);}
    else if(state.status==='Presenting'){state.revision++;state.readyScribeIds=[];state.responseStartsAtMs=null;state.responseEndsAtMs=null;this.save(state);}
  }
  private async recordInterruption(state:SoloState){
    const store=new Store(this.env.DB),prior=await store.get('pbe-solo-interruption',state.sessionId,state.actor.organizationId);
    if(!prior)await store.insert('pbe-solo-interruption',state.sessionId,state.actor.organizationId,{sessionId:state.sessionId,questionId:state.questionId,status:'Interrupted',restartAllowed:true},{ownerId:state.actor.userId});
  }
  private async settle(state:SoloState,request:Request){
    if(state.status==='Settled')return{...state.response as Record<string,unknown>,alreadyProcessed:true};
    if(!state.frozen)throw new HttpError(409,'No frozen answer is ready.');
    state.status='Settling';this.save(state);
    const response=await submitTimedPbeSession(this.context(request,state.actor),state.sessionId,state.frozen.input,state.frozen.elapsedMs,state.frozen.lockedAtMs);
    if(!response)throw new HttpError(404,'Timed rehearsal was not found.');
    if(!response.ok){await this.ctx.storage.setAlarm(Date.now()+1000);return response;}
    state.response=await response.json();state.status='Settled';this.save(state);return state.response;
  }
  private exact(frozen:FrozenSubmission,input:Input){return input.clientSubmissionId===frozen.input.clientSubmissionId&&Array.isArray(input.answers)&&JSON.stringify(input.answers)===JSON.stringify(frozen.retryAnswers);}
  async fetch(request:Request):Promise<Response>{
    try{
      const match=new URL(request.url).pathname.match(/^\/api\/v1\/study\/sessions\/([a-f0-9-]{36})\/timed$/i);if(!match)throw new HttpError(404,'Timed rehearsal route not found.');
      const url=new URL(request.url),expected=url.searchParams.get('questionId'),input=request.method==='POST'?await body<Input>(request,32768):null,ingress=Date.now();
      return await this.serialize(async()=>{
        checkOrigin(request,this.env);const actor=await authenticate(request,this.env),session=await this.session(actor,match[1]);let state=this.load();
        const card=session.cards[session.attempts.length],partCount=card?.question.parts.length??0;if(state)await this.recover(state,partCount);
        if(input?.action==='submit'&&state){
          const historical=state.history.find(entry=>entry.questionId===input.questionId&&entry.revision===input.revision);
          if(historical){if(!this.exact(historical.frozen,input))throw new HttpError(409,'The frozen response has another submission payload.');return json({...historical.response as Record<string,unknown>,alreadyProcessed:true});}
          if(state.status==='Settling'||state.status==='Settled'){
            if(!state.frozen||input.questionId!==state.questionId||input.revision!==state.revision||!this.exact(state.frozen,input))throw new HttpError(409,'The frozen response has another submission payload.');
            const settled=await this.settle(state,request);return settled instanceof Response?settled:json(settled);
          }
        }
        const startsNextCard=input?.action==='present'&&card!==undefined&&state?.questionId!==card.id;
        if(request.method==='POST'&&state&&(state.status==='Settling'||state.status==='Settled')&&!startsNextCard)throw new HttpError(409,'The frozen response cannot be replaced.');
        if(state?.status==='Interrupted'){
          await this.recordInterruption(state);
          if(request.method==='GET')return json({status:'Interrupted',restartAllowed:true,session:{id:session.id,format:session.format,seasonId:session.seasonId,mode:session.mode,status:'Interrupted',targetCardCount:session.cards.length},summary:pbeSummary(session,true),interruption:{status:'Interrupted',restartAllowed:true}});
          throw new HttpError(409,'This rehearsal was interrupted. Start another shortened timed practice.');
        }
        if(request.method==='GET'&&expected){
          const historical=state?.history.find(entry=>entry.questionId===expected);
          if(historical)return json({...historical.response as Record<string,unknown>,alreadyProcessed:true,questionId:historical.questionId});
          if(state?.status==='Settled'&&state.questionId===expected)return json({...state.response as Record<string,unknown>,alreadyProcessed:true,questionId:state.questionId});
          if(card?.id===expected&&state?.questionId!==expected)return json({status:'NotPresented',questionId:card.id,revision:0,serverNow:new Date().toISOString(),feedbackDeferred:true});
          if(state?.questionId!==expected)throw new HttpError(409,'Choose the active saved card.');
        }
        if(request.method==='GET'&&state?.status==='Settled')return json({...state.response as Record<string,unknown>,alreadyProcessed:true,questionId:state.questionId});
        if(request.method==='GET'&&state?.status==='Settling'){const settled=await this.settle(state,request);return settled instanceof Response?settled:json({...settled as Record<string,unknown>,questionId:state.questionId});}
        if(request.method==='GET'&&state?.status==='Armed'&&state.responseEndsAtMs!==null&&ingress>=state.responseEndsAtMs){this.freezeDraft(state,partCount);const settled=await this.settle(state,request);return settled instanceof Response?settled:json({...settled as Record<string,unknown>,questionId:state.questionId});}
        if(request.method==='GET'&&state)return json(this.view(state));
        if(!card||card.servedAtMs===null)throw new HttpError(409,'Choose the active saved card.');
        if(request.method==='GET')return json({status:'NotPresented',questionId:card.id,revision:0,serverNow:new Date().toISOString(),feedbackDeferred:true});
        if(!input||typeof input.action!=='string')throw new HttpError(400,'Choose a timed rehearsal action.');
        if(!state||state.questionId!==card.id){
          if(input.action!=='present')throw new HttpError(409,'Present the active question first.');
          const history=state?.status==='Settled'&&state.frozen&&state.response?[...state.history,{questionId:state.questionId,revision:state.revision,frozen:state.frozen,response:state.response}].slice(-10):state?.history??[];
          state={sessionId:session.id,questionId:card.id,revision:1,delivery:input.delivery==='TextFallback'?'TextFallback':'Audio',requiredScribeIds:[actor.userId],readyScribeIds:[],responseStartsAtMs:null,responseEndsAtMs:null,epoch:this.epoch,status:'Presenting',points:card.question.parts.reduce((n,p)=>n+p.points,0),draft:null,frozen:null,actor,history};this.save(state);return json(this.view(state));
        }
        if(input.action==='present')return json(this.view(state));
        if(input.questionId!==state.questionId||input.revision!==state.revision)throw new HttpError(409,'This action is for another presentation revision.');
        if(input.action==='ack'){
          if(state.status!=='Presenting')return json(this.view(state));
          if(input.delivery!==state.delivery)throw new HttpError(400,'Confirm the saved presentation delivery.');
          const updated=acknowledgePresentation(state,actor.userId,state.questionId,ingress,state.points);state={...state,...updated,status:'Armed'};this.save(state);await this.ctx.storage.setAlarm(state.responseEndsAtMs!);return json(this.view(state));
        }
        if(!['draft','submit'].includes(input.action)||!Array.isArray(input.answers)||input.answers.length!==partCount||input.answers.some(answer=>typeof answer!=='string'||answer.length>10000))throw new HttpError(400,'Provide one text answer per requested part.');
        if(state.status!=='Armed'||state.responseStartsAtMs===null||state.responseEndsAtMs===null||ingress<state.responseStartsAtMs)throw new HttpError(409,'The response window has not opened.');
        if(input.action==='draft'){if(ingress<=state.responseEndsAtMs){state.draft={answers:[...input.answers],elapsedMs:ingress-state.responseStartsAtMs,lockedAtMs:ingress};this.save(state);}return json(this.view(state));}
        const timely=ingress<=state.responseEndsAtMs,draft=!timely?state.draft:null,answers=timely?[...input.answers]:draft?[...draft.answers]:Array.from({length:partCount},()=>'');
        state.frozen={input:{clientSubmissionId:requiredString(input.clientSubmissionId,'Submission ID',200),challengeCardId:card.id,answers,hintsUsed:false},retryAnswers:[...input.answers],elapsedMs:draft?.elapsedMs??Math.max(0,ingress-state.responseStartsAtMs),lockedAtMs:draft?.lockedAtMs??ingress};state.status='Settling';this.save(state);
        const settled=await this.settle(state,request);return settled instanceof Response?settled:json(settled);
      });
    }catch(error){if(error instanceof HttpError)return json({title:error.message,detail:error.message},error.status);console.error('PBE solo authority failed',error instanceof Error?error.name:'UnknownError');return json({title:'Timed rehearsal temporarily unavailable'},503);}
  }
  async alarm(){
    await this.serialize(async()=>{const state=this.load();if(!state)return;const session=await this.session(state.actor,state.sessionId),card=session.cards[session.attempts.length];await this.recover(state,card?.question.parts.length??0);if(state.status==='Interrupted'){await this.recordInterruption(state);return;}if(state.status==='Armed'){if(!card||card.id!==state.questionId){state.status='Interrupted';this.save(state);await this.recordInterruption(state);return;}this.freezeDraft(state,card.question.parts.length);}if(state.status==='Settling')await this.settle(state,new Request(`https://internal/api/v1/study/sessions/${state.sessionId}/timed`));});
  }
}
