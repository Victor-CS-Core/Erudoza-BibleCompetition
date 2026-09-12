import type { Env } from './types';

/** Test bundle only: meter the complete request, including auth and every batch statement. */
export function measureD1Fetch(fetch:(request:Request,env:Env)=>Promise<Response>,beforeStatement?:(sql:string)=>Promise<void>,report?:(meter:{bindingCalls:number;statements:number;methods:Record<string,number>})=>Promise<void>){
 return async(request:Request,env:Env):Promise<Response>=>{
  const startedAt=performance.now();const queryErrors:{method:string;sql:string;sqlLength:number;sqlTruncated:boolean;message:string;messageLength:number;messageTruncated:boolean}[]=[];const queryTimings:{method:string;sql:string;elapsedMs:number}[]=[];let maxReturnedPayloadBytes=0,returnedRows=0,maxReturnedRowsPerQuery=0;let knownRowsRead=0,returnedBytes=0,maxBoundUtf8Bytes=0,firstQueriesWithoutRowsRead=0;
  const recordError=(method:string,sql:string,error:unknown)=>{const message=error instanceof Error?error.message:String(error);queryErrors.push({method,sql:sql.slice(0,500),sqlLength:sql.length,sqlTruncated:sql.length>500,message:message.slice(0,1000),messageLength:message.length,messageTruncated:message.length>1000});};
  const measure=(value:unknown)=>{maxReturnedPayloadBytes=Math.max(maxReturnedPayloadBytes,new TextEncoder().encode(JSON.stringify(value)??'').byteLength);returnedBytes+=new TextEncoder().encode(JSON.stringify(value)??'').byteLength;const results=Array.isArray(value)?value:[value];for(const result of results)if(result&&typeof result==='object'&&'meta' in result){const meta=(result as {meta?:{rows_read?:number}}).meta;if(typeof meta?.rows_read==='number')knownRowsRead+=meta.rows_read;}};
  // Count actual returned data rows, including first() auth/pointer scalars. D1
  // result metadata and batch result envelopes are not data rows. raw() arrays
  // count every returned row (including a requested column-name header).
  const measureRows=(method:string,value:unknown)=>{let rows=0,peak=0;if(method==='first')rows=value===null||value===undefined?0:1;else if(method==='raw')rows=Array.isArray(value)?value.length:0;else {const results=method==='batch'&&Array.isArray(value)?value:[value];for(const result of results)if(result&&typeof result==='object'&&'results' in result){const data=(result as {results?:unknown}).results;if(Array.isArray(data)){rows+=data.length;peak=Math.max(peak,data.length);}}}returnedRows+=rows;maxReturnedRowsPerQuery=Math.max(maxReturnedRowsPerQuery,method==='batch'?peak:rows);};
  let bindingCalls=0,statements=0;const methods:Record<string,number>={};const originals=new WeakMap<object,object>();const queries=new WeakMap<object,string>();
  const count=(method:string,size=1)=>{bindingCalls++;statements+=size;methods[method]=(methods[method]??0)+1;};
  const statement=(value:ReturnType<Env['DB']['prepare']>,sql:string):ReturnType<Env['DB']['prepare']>=>{
   const wrapped=new Proxy(value,{get(target,key){
    if(key==='bind')return (...args:unknown[])=>{for(const arg of args)maxBoundUtf8Bytes=Math.max(maxBoundUtf8Bytes,typeof arg==='string'?new TextEncoder().encode(arg).byteLength:arg instanceof ArrayBuffer?arg.byteLength:0);return statement(target.bind(...args),sql);};
    if(['first','all','raw','run'].includes(String(key)))return async(...args:unknown[])=>{count(String(key));await beforeStatement?.(sql);const queryStarted=performance.now();let result:unknown;try{result=await Reflect.apply(Reflect.get(target,key),target,args);}catch(error){recordError(String(key),sql,error);throw error;}queryTimings.push({method:String(key),sql:sql.slice(0,150),elapsedMs:performance.now()-queryStarted});if(key==='first')firstQueriesWithoutRowsRead++;measureRows(String(key),result);measure(result);return result;};
    const member=Reflect.get(target,key);return typeof member==='function'?member.bind(target):member;
   }});originals.set(wrapped,value);queries.set(wrapped,sql);return wrapped;
  };
  const database=(value:Env['DB']):Env['DB']=>new Proxy(value,{get(target,key){
   if(key==='prepare')return (sql:string)=>statement(target.prepare(sql),sql);
   if(key==='batch')return async(items:Parameters<Env['DB']['batch']>[0])=>{count('batch',items.length);for(const item of items)await beforeStatement?.(queries.get(item)??'');let result:unknown;try{result=await target.batch(items.map(item=>(originals.get(item)??item) as typeof item));}catch(error){recordError('batch',items.map(item=>queries.get(item)??'').join('\n'),error);throw error;}measureRows(String(key),result);measure(result);return result;};
   if(key==='exec')return async(sql:string)=>{await beforeStatement?.(sql);const result=await target.exec(sql);count('exec',result.count);return result;};
   if(key==='withSession')return (...args:unknown[])=>database(Reflect.apply(Reflect.get(target,key),target,args) as Env['DB']);
   const member=Reflect.get(target,key);return typeof member==='function'?member.bind(target):member;
  }});
  const response=await fetch(request,{...env,DB:database(env.DB)});
  await report?.({bindingCalls,statements,methods});
  // Preserve the upgrade socket; reconstructing a101 response drops its WebSocket.
  if(response.status===101)return response;
  const headers=new Headers(response.headers);headers.set('x-test-d1-meter',JSON.stringify({bindingCalls,statements,methods,returnedRows,maxReturnedRowsPerQuery,knownRowsRead,returnedBytes,maxBoundUtf8Bytes,firstQueriesWithoutRowsRead,maxReturnedPayloadBytes,queryErrors,queryTimings,elapsedMs:performance.now()-startedAt}));
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
 };
}

// Test bundle only. Async-local binding ensures overlapping DO requests are metered
// independently, including helper methods using this.env.DB and outbox projection.
// @ts-expect-error Node-only test bundle; production worker types exclude Node APIs.
import { AsyncLocalStorage } from 'node:async_hooks';
export const objectDatabase = new AsyncLocalStorage<Env['DB']>();
export function meteredObjectEnv(env:Env):Env{return new Proxy(env,{get(target,key){return key==='DB'?(objectDatabase.getStore()??target.DB):Reflect.get(target,key);}});}
