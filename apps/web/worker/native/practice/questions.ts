import type {RequestContext} from "../types";
import {admin,body,HttpError,json,noContent} from "../types";
import {effectiveSources} from "../application";
import type {Question} from "./scoring";
import {validateQuestion} from "./scoring";
export const isLegacyQuestion=(q:Question)=>!Object.keys(q).some(key=>key.toLowerCase()==='schemaversion');
export interface QuestionRecord {id:string;seasonId:string;published:boolean;question:Question}
export async function eligibleQuestions(ctx:RequestContext,seasonId:string,count:number,bookKey?:string):Promise<Question[]> {
 const sources=new Map((await effectiveSources(ctx,seasonId)).filter(s=>!bookKey||s.bookKey===bookKey).map(s=>[s.id,s]));
 const records=await ctx.store.list<QuestionRecord>("question",ctx.orgId,{seasonId}),latest=new Map<string,Question>();
 for(const record of records.filter(r=>r.published&&isLegacyQuestion(r.question))){const q=record.question,source=sources.get(q.sourceUnitId);if(!source||source.contentPackId!==q.contentPackId)continue;if((latest.get(q.id)?.version??0)<q.version)latest.set(q.id,q);}
 let booleans=0;const selected=[...latest.values()].sort((a,b)=>a.id.localeCompare(b.id)).filter(q=>q.kind!=="TrueFalse"||++booleans<=Math.floor(count/10));
 if(selected.length<count)throw new HttpError(400,`This scope needs ${count} eligible published questions; ${selected.length} are available.`);return selected;
}
export async function questionRoutes(ctx:RequestContext):Promise<Response|null>{
 const path=ctx.path.replace(/^\/practice/,"");
 if(path==="/questions/import"&&ctx.request.method==="POST"){
  admin(ctx.actor);const input=await body<{seasonId:string;questions:Question[]}>(ctx.request);await ctx.store.require("season",input.seasonId,ctx.orgId);
  if(!Array.isArray(input.questions)||!input.questions.length||input.questions.length>100)throw new HttpError(400,"Import between one and 100 questions per batch.");
  const sources=new Map((await effectiveSources(ctx,input.seasonId)).map(s=>[s.id,s]));const rows:QuestionRecord[]=[],keys=new Set<string>();
  for(const incoming of input.questions){if(!incoming||!isLegacyQuestion(incoming))throw new HttpError(400,"Versioned PBE questions require the PBE import endpoint.");const q={...incoming,id:incoming.id||crypto.randomUUID()},source=sources.get(q.sourceUnitId);if(!source||source.contentPackId!==q.contentPackId)throw new HttpError(400,"Each question must reference approved season content.");q.reference=source.citation;validateQuestion(q);const key=`${q.id}:${q.version}`;if(keys.has(key))throw new HttpError(409,"This question version already exists.");keys.add(key);const row:QuestionRecord={id:key,seasonId:input.seasonId,published:false,question:q};rows.push(row);}
  const duplicate=await ctx.env.DB.prepare("SELECT 1 FROM Records WHERE kind='question' AND org_id=? AND id IN (SELECT value FROM json_each(?)) LIMIT 1").bind(ctx.orgId,JSON.stringify([...keys])).first();if(duplicate)throw new HttpError(409,"This question version already exists.");
  try{await ctx.env.DB.prepare("INSERT INTO Records(kind,id,org_id,season_id,data) SELECT 'question',json_extract(value,'$.id'),?,?,value FROM json_each(?)").bind(ctx.orgId,input.seasonId,JSON.stringify(rows)).run();}catch(error){if(String(error).includes("UNIQUE"))throw new HttpError(409,"This question version already exists.");throw error;}return noContent();
 }
 const publish=path.match(/^\/questions\/([^/]+)\/publish$/);
 if(publish&&ctx.request.method==="POST"){admin(ctx.actor);const row=await ctx.store.require<QuestionRecord>("question",decodeURIComponent(publish[1]),ctx.orgId);validateQuestion(row.value.question);await ctx.store.put("question",row.value.id,ctx.orgId,{...row.value,published:true},row.revision);return noContent();}
 return null;
}
export async function enabled(ctx:RequestContext){const flag=await ctx.store.get<{enabled:boolean}>("practice-setting",ctx.orgId,ctx.orgId);if(flag?.value.enabled===false)throw new HttpError(403,"Team Practice is not enabled for this organization.");}
export async function setEnabled(ctx:RequestContext){admin(ctx.actor);const input=await body<{enabled:boolean}>(ctx.request,1024);if(typeof input.enabled!=="boolean")throw new HttpError(400,"Provide an enabled flag.");const flag=await ctx.store.get("practice-setting",ctx.orgId,ctx.orgId);if(flag)await ctx.store.put("practice-setting",ctx.orgId,ctx.orgId,input,flag.revision);else await ctx.store.insert("practice-setting",ctx.orgId,ctx.orgId,input);return json(input);}
