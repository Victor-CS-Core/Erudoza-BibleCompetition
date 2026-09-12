import type { Env } from './types';

/** Test bundle only: meter the complete request, including auth and every batch statement. */
export function measureD1Fetch(fetch:(request:Request,env:Env)=>Promise<Response>,beforeStatement?:(sql:string)=>Promise<void>,report?:(meter:{bindingCalls:number;statements:number;methods:Record<string,number>})=>Promise<void>){
 return async(request:Request,env:Env):Promise<Response>=>{
  let bindingCalls=0,statements=0;const methods:Record<string,number>={};const originals=new WeakMap<object,object>();const queries=new WeakMap<object,string>();
  const count=(method:string,size=1)=>{bindingCalls++;statements+=size;methods[method]=(methods[method]??0)+1;};
  const statement=(value:ReturnType<Env['DB']['prepare']>,sql:string):ReturnType<Env['DB']['prepare']>=>{
   const wrapped=new Proxy(value,{get(target,key){
    if(key==='bind')return (...args:unknown[])=>statement(target.bind(...args),sql);
    if(['first','all','raw','run'].includes(String(key)))return async(...args:unknown[])=>{count(String(key));await beforeStatement?.(sql);return Reflect.apply(Reflect.get(target,key),target,args);};
    const member=Reflect.get(target,key);return typeof member==='function'?member.bind(target):member;
   }});originals.set(wrapped,value);queries.set(wrapped,sql);return wrapped;
  };
  const database=(value:Env['DB']):Env['DB']=>new Proxy(value,{get(target,key){
   if(key==='prepare')return (sql:string)=>statement(target.prepare(sql),sql);
   if(key==='batch')return async(items:Parameters<Env['DB']['batch']>[0])=>{count('batch',items.length);for(const item of items)await beforeStatement?.(queries.get(item)??'');return target.batch(items.map(item=>(originals.get(item)??item) as typeof item));};
   if(key==='exec')return async(sql:string)=>{await beforeStatement?.(sql);const result=await target.exec(sql);count('exec',result.count);return result;};
   if(key==='withSession')return (...args:unknown[])=>database(Reflect.apply(Reflect.get(target,key),target,args) as Env['DB']);
   const member=Reflect.get(target,key);return typeof member==='function'?member.bind(target):member;
  }});
  const response=await fetch(request,{...env,DB:database(env.DB)});
  await report?.({bindingCalls,statements,methods});
  const headers=new Headers(response.headers);headers.set('x-test-d1-meter',JSON.stringify({bindingCalls,statements,methods}));
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
 };
}

// Test bundle only. Async-local binding ensures overlapping DO requests are metered
// independently, including helper methods using this.env.DB and outbox projection.
// @ts-expect-error Node-only test bundle; production worker types exclude Node APIs.
import { AsyncLocalStorage } from 'node:async_hooks';
export const objectDatabase = new AsyncLocalStorage<Env['DB']>();
export function meteredObjectEnv(env:Env):Env{return new Proxy(env,{get(target,key){return key==='DB'?(objectDatabase.getStore()??target.DB):Reflect.get(target,key);}});}
