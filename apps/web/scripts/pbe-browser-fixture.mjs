/* global Buffer */
import {createServer} from 'node:http';

const guid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const maxBodyBytes=8192;

function fixtureBody(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid fixture body.');
 const required=['organizationId','seasonId','studentId','chapterKey','label','scopeLabel','scopeVersion','earnedAtUtc'];
 for(const key of required)if(typeof value[key]!=='string'||value[key].length<1||value[key].length>1000)throw new Error(`Invalid ${key}.`);
 for(const key of ['organizationId','seasonId','studentId'])if(!guid.test(value[key]))throw new Error(`Invalid ${key}.`);
 if(value.label.length>120||value.scopeLabel.length>240||value.scopeVersion.length>128||value.chapterKey.length>1000)throw new Error('Fixture text is too long.');
 const earnedAt=new Date(value.earnedAtUtc);
 if(Number.isNaN(earnedAt.valueOf())||earnedAt.toISOString()!==value.earnedAtUtc)throw new Error('Invalid earnedAtUtc.');
 return value;
}

async function readJson(request){
 const chunks=[];let size=0;
 for await(const chunk of request){size+=chunk.length;if(size>maxBodyBytes)throw new Error('Fixture body is too large.');chunks.push(chunk);}
 return fixtureBody(JSON.parse(Buffer.concat(chunks).toString('utf8')));
}

export function syntheticStamp(body){
 const stampId=`synthetic-browser:${body.seasonId}`;
 return {stampId,data:{
  summary:{stampId,chapterKey:body.chapterKey,kind:'Chapter',label:body.label,scopeLabel:body.scopeLabel,scopeVersion:body.scopeVersion,ruleVersion:'pbe-chapter-v1',earnedAtUtc:body.earnedAtUtc,matchesCurrentScope:false},
  proofGenerationId:'synthetic-browser-history',proofFamily:'chapter',targetCount:1,qualifyingAttemptCount:2,proofPageCount:1,proofHash:'synthetic-browser-history-only',
 }};
}

export async function startPbeBrowserFixtureServer({port,runId,insert}){
 if(typeof runId!=='string'||runId.length<16)throw new Error('Explicit browser fixture run identity required.');
 const inserted=new Set();
 const server=createServer(async(request,response)=>{
  try{
   if(request.method!=='POST'||request.url!=='/seed-pbe-history'){response.writeHead(404).end();return;}
   if(request.headers['x-erudoza-fixture-run']!==runId){response.writeHead(403).end();return;}
   const body=await readJson(request),stamp=syntheticStamp(body);
   const key=`${body.organizationId}:${body.seasonId}`.toLowerCase();
   if(inserted.has(key)){response.writeHead(409).end();return;}
   inserted.add(key);
   try{await insert(body,stamp);}catch(error){inserted.delete(key);throw error;}
   response.writeHead(201,{'content-type':'application/json'}).end(JSON.stringify({stampId:stamp.stampId,fixture:'synthetic-history'}));
  }catch(error){response.writeHead(400,{'content-type':'application/json'}).end(JSON.stringify({error:error instanceof Error?error.message:'Invalid fixture.'}));}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 return server;
}
