import type {Room} from './state';

export const ROOM_STORAGE_FORMAT='erudoza.practice-room/1';
export const ROOM_LEAF_BYTES=128*1024,ROOM_BRANCH_CHILDREN=256,ROOM_STAGE_NODES=8,ROOM_STAGE_BYTES=1024*1024;
const encoder=new TextEncoder();
export const utf8Bytes=(s:string)=>encoder.encode(s).byteLength;
export async function contentHash(data:string):Promise<string>{return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(data))),b=>b.toString(16).padStart(2,'0')).join('');}
export interface ComponentRef {hash:string;bytes:number}
export type ComponentNode={nodeVersion:1;type:'leaf';data:string}|{nodeVersion:1;type:'branch';children:string[]};
export interface RoomManifest {
 format:typeof ROOM_STORAGE_FORMAT;id:string;orgId:string;seasonId:string;revision:number;
 metadata:ComponentRef;questions:(ComponentRef&{id:string;version:number})[];reserves:(ComponentRef&{id:string;version:number})[];
 submissions:(ComponentRef&{questionId:string;team:number;attemptId?:string})[];
}
export type ReadNode=(hash:string)=>Promise<string|null>|string|null;
const isHash=(s:unknown):s is string=>typeof s==='string'&&/^[0-9a-f]{64}$/.test(s);
const invalid=()=>new Error('Stored room component is missing or corrupt.');
export function isRoomManifest(value:unknown):value is RoomManifest{return !!value&&typeof value==='object'&&(value as {format?:unknown}).format===ROOM_STORAGE_FORMAT;}
export function manifestRefs(m:RoomManifest):ComponentRef[]{return [m.metadata,...m.questions,...m.reserves,...m.submissions];}
export function validateManifest(m:RoomManifest):void{
 if(!isRoomManifest(m)||![m.id,m.orgId,m.seasonId].every(x=>typeof x==='string'&&x.length>0)||!Number.isSafeInteger(m.revision)||m.revision<0||!Array.isArray(m.questions)||!Array.isArray(m.reserves)||!Array.isArray(m.submissions)||m.questions.length>90||m.reserves.length>1||m.submissions.length>180||utf8Bytes(JSON.stringify(m))>ROOM_LEAF_BYTES)throw invalid();
 if(manifestRefs(m).some(r=>!r||!isHash(r.hash)||!Number.isSafeInteger(r.bytes)||r.bytes<0))throw invalid();
 if(new Set(m.questions.map(q=>q.id)).size!==m.questions.length||m.submissions.some(s=>!m.questions.some(q=>q.id===s.questionId))||new Set(m.submissions.map(s=>JSON.stringify([s.questionId,s.team]))).size!==m.submissions.length)throw invalid();
}
export async function parseNode(hash:string,data:string):Promise<ComponentNode>{
 if(!isHash(hash)||utf8Bytes(data)>=ROOM_STAGE_BYTES||await contentHash(data)!==hash)throw invalid();
 const node=JSON.parse(data) as ComponentNode;
 if(node.nodeVersion!==1)throw invalid();
 if(node.type==='leaf'){if(typeof node.data!=='string'||utf8Bytes(node.data)>ROOM_LEAF_BYTES)throw invalid();}
 else if(node.type==='branch'){if(!Array.isArray(node.children)||!node.children.length||node.children.length>ROOM_BRANCH_CHILDREN||!node.children.every(isHash))throw invalid();}
 else throw invalid();
 return node;
}
export async function encodeComponent(value:unknown,nodes:Map<string,string>):Promise<ComponentRef>{
 const text=JSON.stringify(value),bytes=encoder.encode(text),decoder=new TextDecoder('utf-8',{fatal:true});
 let hashes:string[]=[];
 const add=async(node:ComponentNode)=>{const data=JSON.stringify(node),hash=await contentHash(data);nodes.set(hash,data);return hash;};
 for(let offset=0;offset<bytes.length;){let end=Math.min(offset+ROOM_LEAF_BYTES,bytes.length);while(end<bytes.length&&(bytes[end]&0xc0)===0x80)end--;const data=decoder.decode(bytes.subarray(offset,end));hashes.push(await add({nodeVersion:1,type:'leaf',data}));offset=end;}
 while(hashes.length>1){const next:string[]=[];for(let offset=0;offset<hashes.length;offset+=ROOM_BRANCH_CHILDREN)next.push(await add({nodeVersion:1,type:'branch',children:hashes.slice(offset,offset+ROOM_BRANCH_CHILDREN)}));hashes=next;}
 return {hash:hashes[0],bytes:bytes.length};
}
export async function readComponent<T>(ref:ComponentRef,read:ReadNode):Promise<T>{
 const pieces:string[]=[],active=new Set<string>();let bytes=0;
 const visit=async(hash:string)=>{if(active.has(hash))throw invalid();active.add(hash);const data=await read(hash);if(data===null)throw invalid();const node=await parseNode(hash,data);if(node.type==='leaf'){bytes+=utf8Bytes(node.data);if(bytes>ref.bytes)throw invalid();pieces.push(node.data);}else for(const child of node.children)await visit(child);active.delete(hash);};
 await visit(ref.hash);if(bytes!==ref.bytes)throw invalid();return JSON.parse(pieces.join('')) as T;
}
/** Cache only frozen question objects. Finals and metadata are re-encoded because legacy/test repair can alter them. */
export class RoomCodec {
 private frozen=new WeakMap<object,ComponentRef>();
 async encode(r:Room):Promise<{manifest:RoomManifest;nodes:Map<string,string>}>{
  const nodes=new Map<string,string>(),{questions,reserves,submissions,...metadata}=r;
  const question=async(q:Room['questions'][number])=>{let ref=this.frozen.get(q);if(!ref){ref=await encodeComponent(q,nodes);this.frozen.set(q,ref);}return {...ref,id:q.id,version:q.version};};
  const qs:RoomManifest['questions']=[],rs:RoomManifest['reserves']=[],ss:RoomManifest['submissions']=[];
  for(const q of questions)qs.push(await question(q));for(const q of reserves)rs.push(await question(q));for(const s of submissions)ss.push({...await encodeComponent(s,nodes),questionId:s.questionId,team:s.team,attemptId:s.attemptId});
  const manifest:RoomManifest={format:ROOM_STORAGE_FORMAT,id:r.id,orgId:r.orgId,seasonId:r.seasonId,revision:r.revision,metadata:await encodeComponent(metadata,nodes),questions:qs,reserves:rs,submissions:ss};validateManifest(manifest);return {manifest,nodes};
 }
 async decode(m:RoomManifest,read:ReadNode):Promise<Room>{
  validateManifest(m);const metadata=await readComponent<Omit<Room,'questions'|'reserves'|'submissions'>>(m.metadata,read);
  if(metadata.id!==m.id||metadata.orgId!==m.orgId||metadata.seasonId!==m.seasonId||metadata.revision!==m.revision||metadata.format!=='Pbe')throw invalid();
  const questions:Room['questions']=[],reserves:Room['reserves']=[],submissions:Room['submissions']=[];
  for(const [refs,target] of [[m.questions,questions],[m.reserves,reserves]] as const)for(const ref of refs){const q=await readComponent<Room['questions'][number]>(ref,read);if(q.id!==ref.id||q.version!==ref.version)throw invalid();this.frozen.set(q,ref);target.push(q);}
  for(const ref of m.submissions){const s=await readComponent<Room['submissions'][number]>(ref,read);if(s.questionId!==ref.questionId||s.team!==ref.team||s.attemptId!==ref.attemptId)throw invalid();submissions.push(s);}
  return {...metadata,questions,reserves,submissions};
 }
}
