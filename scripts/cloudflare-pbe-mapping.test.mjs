import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mapCanonicalPbe} from './lib/cloudflare-pbe-mapping.mjs';

const org='10000000-0000-4000-8000-000000000001', season='20000000-0000-4000-8000-000000000001', owner='30000000-0000-4000-8000-000000000001';
const row=(Kind,DataJson,Id=Kind,Revision=7)=>({OrganizationId:org,SeasonId:season,OwnerId:owner,Kind,Id,Revision,DataJson:typeof DataJson==='string'?DataJson:JSON.stringify(DataJson)});
const map=records=>mapCanonicalPbe({snapshot:{tables:{PbeTrainingRecords:records},definitions:[]},nativeCore:{organizations:[{id:org}],users:[],records:[]}});

test('preserves target JSON bytes, compound identity and actual revision',async()=>{
 const source=row('pbe-target','{ "id":"Target-A", "sourceUnitIds":["Source-A"], "skill":"ExactWords", "label":"Raw \\u0041" }','Target-A');
 const result=await map([source]);
 assert.deepEqual(result.records,[{kind:source.Kind,id:source.Id,org_id:org,season_id:season,owner_id:owner,data:source.DataJson,revision:7}]);
 assert.ok(result.consumedTables.includes('PbeTrainingRecords'));
});
test('maps account-private notebook aggregates without treating them as PBE activity',async()=>{
 const value={entries:[{id:'40000000-0000-7000-8000-000000000001',kind:'note',contentPackId:'50000000-0000-5000-8000-000000000001',chapter:1,sourceUnitId:'60000000-0000-5000-8000-000000000001',startOffset:0,endOffset:5,color:null,note:'Private',bookName:'Ephesians',citation:'Ephesians 1:1',quote:'Grace',updatedAtUtc:at}]};
 const source={...row('scripture-notebook',value,owner,3),SeasonId:'00000000-0000-0000-0000-000000000000'};
 const result=await map([source]);
 assert.deepEqual(result.records,[{kind:'scripture-notebook',id:owner,org_id:org,season_id:null,owner_id:owner,data:source.DataJson,revision:3}]);
 await assert.rejects(map([{...source,DataJson:JSON.stringify({entries:[...value.entries,{...value.entries[0],id:'invalid'}]})}]),/notebook|UUID|entry/);
});
test('preserves dictionary keys in attempt review and result overlay',async()=>{
 const value={id:'review',questionId:'Question',status:'Resolved',pointsByTarget:{TargetA:1,targetA:0,'__proto__':2}};
 const result=await map([row('pbe-attempt-review',value)]);
 assert.deepEqual(JSON.parse(result.records[0].data),value);
});
test('rejects unknown operational fields, unsafe revision and unknown kinds',async()=>{
 await assert.rejects(map([row('pbe-target',{id:'t',sourceUnitIds:['s'],skill:'ExactWords',label:'t',hiddenFact:1})]),/field/);
 await assert.rejects(map([row('pbe-target',{id:'t',sourceUnitIds:['s'],skill:'ExactWords',label:'t'},'t',9007199254740993n)]),/revision|integer/);
 await assert.rejects(map([row('pbe-future',{id:'future'})]),/unsupported/);
});
test('rejects duplicate compound keys and undrained authority',async()=>{
 const r=row('pbe-target',{id:'t',sourceUnitIds:['s'],skill:'ExactWords',label:'t'});
 await assert.rejects(map([r,r]),/duplicate/);
 await assert.rejects(map([row('pbe-solo-outbox',{sessionId:'s'})]),/outbox|unsupported/);
});

const at='2026-09-12T10:00:00.000+00:00';
const q={schemaVersion:2,id:'q',version:2,contentPackId:'pack',sourceUnitId:'source',sourceUnitIds:['source'],sourceKind:'Scripture',reference:'GEN 1:1',evidence:'Raw text',kind:'ExactWords',prompt:'Two blanks',ordered:true,parts:[{targetId:'t',acceptedAnswers:['One'],points:1},{targetId:'t',acceptedAnswers:['Two'],points:1}]};
const versions={format:'Pbe',ruleVersion:'nad-pbe-2023-24-v2',scoringVersion:'pbe-rubric-v2',selectionVersion:'pbe-selection-v1'};
const attempt={id:'attempt',cardId:'card',clientSubmissionId:'KeepCase',answers:['','Two'],hintsUsed:false,atMs:Date.parse(at),responseLockedAtUtc:at,result:{attemptId:'attempt',earnedPoints:1,availablePoints:2,expectedParts:['One','Two'],sourceEvidence:'Raw text',citation:'GEN 1:1',unaided:true,acceptedAtUtc:at,acceptedSequence:19,alreadyProcessed:false}};
const session={id:'session',studentUserId:owner,seasonId:season,scopeVersion:'frozen',...versions,mode:'Practice',status:'Active',questionIds:['q'],cards:[{id:'card',question:q,targets:[{id:'t',sourceUnitIds:['source'],skill:'ExactWords',label:'t'}],servedAtMs:Date.parse(at),assistedAtMs:null}],attempts:[attempt],createdAtUtc:at,completedAtUtc:null,clientStartId:null,startPayload:'raw payload',missionLocalDate:null,creditedLocalDate:null,newlyCreditedDay:false,timing:null,timingQuestionId:null,timingStatus:null};
test('maps non-timed session and frozen attempt without changing indexed answer empties or result',async()=>{
 const result=await map([row('pbe-session',session),row('pbe-attempt',{...attempt,sessionId:'session',...versions})]);
 const saved=JSON.parse(result.records[0].data),savedAttempt=JSON.parse(result.records[1].data);
 assert.deepEqual(saved.attempts[0].answers,['','Two']);assert.deepEqual(saved.attempts[0].result,attempt.result);
 assert.equal(saved.attempts[0].responseLockedAtMs,Date.parse(at));assert.equal(savedAttempt.responseLockedAtMs,Date.parse(at));
 await assert.rejects(map([row('pbe-session',{...session,mode:'Simulation'})]),/unsupported/);
});
const practiceQ={id:q.id,version:q.version,contentPackId:q.contentPackId,sourceUnitId:q.sourceUnitId,prompt:q.prompt,kind:q.kind,parts:q.parts.map(({acceptedAnswers,points})=>({acceptedAnswers,points})),ordered:q.ordered,evidence:q.evidence,reference:q.reference,rubric:q};
const terminal={format:'Pbe',teamCount:1,selectionVersion:'pbe-team-question-max-v1',selectionSeed:'seed',coachReading:null,coachReadyScribeIds:[],presentationDelivery:{PlayerABC:'TextFallback'},draftReceivedAt:{1:Date.parse(at)},sourceProofs:{QCase:'OpaqueProof'},interruptionReason:null,replacements:[],presentations:{q:{scheduleId:'schedule',responseStartsAtUtc:at,responseEndsAtUtc:'2026-09-12T10:00:30.000+00:00',delivery:{PlayerABC:'TextFallback'},coachReading:null}},services:[],id:'room',seasonId:season,ownerId:owner,coachId:null,teamSize:2,questionCount:10,bookKey:null,coached:false,status:'Completed',phase:'Complete',ruleVersion:'pbe-rehearsal-v1',scoringVersion:'pbe-accuracy-v1',revision:51,questionIndex:0,processId:'original-process',phaseTimestamp:123,responseTimestamp:234,phaseEndsAt:null,responseStartsAt:at,scheduleId:'schedule',acknowledged:[owner],members:[{userId:owner,displayName:'Original name',team:1,ready:true,captain:true,scribe:true}],invitations:[],questions:[practiceQ],reserves:[],submissions:[{attemptId:'team-attempt',responseLockedAtUtc:at,questionId:'q',team:1,scribeId:owner,answers:['','Two'],elapsedTicks:12500000,deadlineDraft:false,accuracyHundredths:100,speedHundredths:0,appealed:false,resolved:true,appealReason:null}],messages:[],drafts:{1:['','Two']},appliedCommands:{CommandABC:owner,commandABC:owner},contributions:[],completedAt:at,awards:[],adjustments:[],timingDiagnostics:{}};
const roomRow=state=>({Id:'room',OrganizationId:org,SeasonId:season,Status:state.status,Revision:51,UpdatedAt:at,StateJson:JSON.stringify(state)});
const mapRoom=state=>mapCanonicalPbe({snapshot:{tables:{PracticeRoomRecord:[roomRow(state)]}},nativeCore:{records:[]}});
test('maps complete terminal PBE authority including applied dictionary, frozen rubric and timing',async()=>{
 const result=await mapRoom(terminal),r=result.rooms[0].room;
 assert.deepEqual(r.applied,terminal.appliedCommands);assert.deepEqual(r.questions,[q]);assert.deepEqual(r.drafts,terminal.drafts);
 assert.equal(r.submissions[0].elapsedMs,1250);assert.equal(r.submissions[0].attemptId,'team-attempt');assert.equal(r.revision,51);
 assert.deepEqual(r.presentations.q.delivery,{PlayerABC:'TextFallback'});assert.deepEqual(r.sourceProofs,{QCase:'OpaqueProof'});
 assert.deepEqual(result.rooms[0].scope,{kind:'room',orgId:org,seasonId:season,id:'room'});
});
test('accepts Interrupted full authority and rejects active or stripped public recap',async()=>{
 const result=await mapRoom({...terminal,status:'Interrupted',phase:'Interrupted',interruptionReason:'ArmedResponsesUntrusted',completedAt:null});assert.equal(result.rooms[0].room.status,'Interrupted');
 await assert.rejects(mapRoom({...terminal,status:'Playing'}),/unsupported/);
 const {appliedCommands,...stripped}=terminal;await assert.rejects(mapRoom(stripped),/appliedCommands|authority/);
});
test('preserves canonical Completed/Review terminal phase and exact command authority through native codec',async()=>{
 // PracticeMatchEngine.Next completes the actual full90 source without rewriting Review.
 const commandId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',state={...terminal,phase:'Review',questionCount:90,questionIndex:89,appliedCommands:{...terminal.appliedCommands,[commandId]:owner},questions:Array.from({length:90},(_,i)=>({...practiceQ,id:i?`q${i}`:'q',rubric:{...q,id:i?`q${i}`:'q'}}))};
 const r=(await mapRoom(state)).rooms[0].room,{RoomCodec,view,applyCommand}=await productCodecs(),encoded=await new RoomCodec().encode(r),decoded=await new RoomCodec().decode(encoded.manifest,h=>encoded.nodes.get(h)??null);
 assert.deepEqual(decoded,r);assert.equal(decoded.phase,'Review');assert.equal(decoded.status,'Completed');assert.equal(decoded.phaseEndsAt,null);assert.equal(decoded.completedAt,state.completedAt);assert.equal(decoded.revision,state.revision);assert.deepEqual(decoded.applied,state.appliedCommands);assert.equal(decoded.canonicalProvenance.stateSha256,hash(JSON.stringify(state)));
 const actor={userId:owner,organizationId:org,displayName:'Original name',kind:'Student',role:'Student'};
 const before=JSON.stringify(decoded);applyCommand(decoded,actor,{commandId,revision:51,action:'submit'},0,0);assert.equal(JSON.stringify(decoded),before);
 assert.equal(view(decoded,actor,Date.parse(at)).phase,'Review');
});
test('rejects nonterminal or mismatched terminal Review phase authority',async()=>{
 for(const state of [{...terminal,status:'Playing',phase:'Review'},{...terminal,status:'Interrupted',phase:'Review'},{...terminal,status:'Completed',phase:'Interrupted'},{...terminal,phase:'Review',completedAt:null},{...terminal,phase:'Review',phaseEndsAt:at}])await assert.rejects(mapRoom(state),/unsupported|terminal|completion|value/);
});

import {createHash} from 'node:crypto';
const hash=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const gen='40000000-0000-4000-8000-000000000001';
const witness=[{targetId:'t',questionId:'q1',questionVersion:1,attemptId:'a1',atMs:Date.parse(at)-172800000,acceptedSequence:1},{targetId:'t',questionId:'q2',questionVersion:2,attemptId:'a2',atMs:Date.parse(at),acceptedSequence:2}];
const proofEntries=[{targetId:'t',witness}],proofId=`${gen}:proof-000000:000000`;
const proof={generationId:gen,family:'proof-000000',entries:proofEntries,hash:hash(proofEntries)};
const stampId=`${owner}:${season}:${hash(['chapter:pack:GEN:1','scope','pbe-chapter-v1'])}`;
const stamp={summary:{stampId,chapterKey:'chapter:pack:GEN:1',kind:'Chapter',label:'GEN 1',scopeLabel:'Whole assigned chapter',scopeVersion:'scope',ruleVersion:'pbe-chapter-v1',earnedAtUtc:at,matchesCurrentScope:true},proofGenerationId:gen,proofFamily:'proof-000000',targetCount:1,qualifyingAttemptCount:2,proofPageCount:1,proofHash:hash([[proofId,proof.hash]])};
test('maps historical immutable chapter stamp and witness closure without a current generation',async()=>{
 const result=await map([row('pbe-chapter-stamp-proof',proof,proofId,1),row('pbe-chapter-stamp',stamp,stampId,1)]);
 assert.deepEqual(JSON.parse(result.records.find(r=>r.kind==='pbe-chapter-stamp-proof').data),{id:proofId,...proof});
 assert.deepEqual(JSON.parse(result.records.find(r=>r.kind==='pbe-chapter-stamp').data),{id:stampId,...stamp});
 await assert.rejects(map([row('pbe-chapter-stamp-proof',{...proof,hash:'broken'},proofId,1),row('pbe-chapter-stamp',stamp,stampId,1)]),/hash/);
});
test('maps awards explicitly with native identity and source entity initial revision',async()=>{
 const result=await mapCanonicalPbe({snapshot:{tables:{PracticeAwardRecord:[{OrganizationId:org,SeasonId:season,UserId:owner,Key:'pbe-team-v1:first-fellowship',Title:'First Fellowship',ReconciledAt:at}]}},nativeCore:{records:[]}});
 assert.equal(result.records[0].kind,'award');assert.equal(result.records[0].id,`pbe-team-v1:first-fellowship:${owner}:${season}`);assert.equal(result.records[0].revision,1);
});
function chapterFixture(){
 const scopeEntry={Id:'scope-entry',OrganizationId:org,SeasonId:season,ContentPackId:'pack',Kind:1,BookKey:'GEN',StartChapter:1,StartVerse:1,EndChapter:2,EndVerse:3};
 const assignment={Id:'assignment',OrganizationId:org,SeasonId:season,StudentUserId:owner,Type:2};
 const assignmentScope={Id:'assignment-scope',AssignmentId:'assignment',ContentPackId:'pack',BookKey:'GEN',StartChapter:1,StartVerse:1,EndChapter:2,EndVerse:3};
 const pack={Id:'pack',OrganizationId:org,IsActive:1,IsBuiltIn:0,LicensingStatus:'approved',SourceType:1};
 const member={Id:'member',OrganizationId:org,SeasonId:season,UserId:owner};
 const target={id:'t',sourceUnitIds:['source'],skill:'ExactWords',label:'t'};
 const proj={id:`${owner}:${season}:t`,targetId:'t',review:{targetId:'t',intervalIndex:1,dueAtMs:0,unresolved:false,lastAttemptId:'a2',lastQuestionId:'q2',lastSuccessfulAtMs:Date.parse(at)},acceptedSequence:2,failedSequence:null,lastAnsweredQuestionId:'q2',lastAnsweredQuestionKind:'ExactWords',provisional:false,pendingCount:0,evidenceGeneration:null,retention:{ruleVersion:'pbe-retention-v1',practiced:true,recalled:true,pendingCount:0,lastAcceptedSequence:2,lastFailureSequence:null,earliest:witness,latest:witness,witness,dataGap:false}};
 const controls=[['control','scope','scope-entry','pack','Include','GEN',1,1,2,3],['control','assignment','assignment','RequiredCoverage'],['control','assignment-scope','assignment-scope','assignment','pack','GEN',1,1,2,3],['control','pack','pack',org,true,false,'approved','Scripture'],['control','member','member',owner]];
 const tuples=[...controls,['source','source','pack','Scripture','GEN',1,1,1,'GEN 1:1',hash('Raw text')],['bank','pbe-target','t','source',5],['target','t',JSON.stringify(target)],['bank','pbe-question-head','q','source',3],['question','q',JSON.stringify(q)],['retention','t',JSON.stringify(proj),7]];
 const scopeHash=hash(['pbe-chapter-v1','pbe-passage-groups-v1',season,owner,[['source','pack','Scripture','GEN',1,1,1,'GEN 1:1',hash('Raw text')]],[['t',['source'],'ExactWords']],[['q',2,['source'],'ExactWords',true,[['t',1],['t',1]]]],[['assignment','assignment','pack','GEN',1,1,2,3]]]);
 const entries=tuples.map(t=>JSON.stringify(t)),manifest=row('pbe-chapter-manifest',entries,`${gen}:inputs:000000`,1);
 const work={schemaVersion:1,id:gen,state:'Working',stage:'Projecting',reason:null,scopeVersion:scopeHash,asOfUtc:at,dueRefreshAtUtc:at,inputOffset:entries.length,inputPages:1,stagedBytes:Buffer.byteLength(manifest.DataJson),rowOffset:0,snapshotId:null,abandonedId:null,proofOffset:0,proofPages:0,proofFingerprint:null,capturePhase:'aggregate',after:'',familyRows:0,sourceCount:1,scriptureCount:1,groupAfter:'',aggregate:null,proofBytes:0};
 const r=(kind,id,data,owner_id=null)=>({kind,id,org_id:org,season_id:season,owner_id,data,revision:1});
 const nativeCore={organizations:[{id:org}],users:[{id:owner,org_id:org,active:1,kind:'Student',role:'Student'}],records:[r('season',season,{organizationId:org,status:'Active',pbeEnabled:true}),r('scope',season,{packs:[{contentPackId:'pack',includes:[{bookKey:'GEN',startChapter:1,startVerse:1,endChapter:2,endVerse:3}],excludes:[]}]}),r('membership',`${season}:${owner}`,{},owner),r('assignment','assignment',{contentPackId:'pack',bookKey:'GEN',startChapter:1,startVerse:1,endChapter:2,endVerse:3},owner),r('pack','pack',{sourceType:'Scripture',isActive:true,licensingStatus:'approved'}),r('source','source',{id:'source',contentPackId:'pack',bookKey:'GEN',chapter:1,verse:1,ordinal:1,citation:'GEN 1:1',canonicalText:'Raw text',isActive:true,isRetired:false},'pack')]};
 return {snapshot:{tables:{PbeTrainingRecords:[manifest,row('pbe-chapter-work',work,`${owner}:${season}`,4)],ScopeEntries:[scopeEntry],Assignments:[assignment],AssignmentScopes:[assignmentScope],ContentPacks:[pack],CompetitionMembers:[member]}},nativeCore};
}
test('maps a captured chapter generation with exact native seals, bytes and continuation pointer',async()=>{
 const fixture=chapterFixture(),result=await mapCanonicalPbe(fixture),records=result.records.map(r=>({...r,value:JSON.parse(r.data)})),work=records.find(r=>r.kind==='pbe-chapter-work').value;
 assert.equal(work.workId,gen);assert.equal(work.stage,'Projecting');assert.equal(work.rowIndex,0);assert.equal(work.proofBytes,0);
 const pages=records.filter(r=>r.kind==='pbe-chapter-manifest');assert.equal(work.pageCount,pages.length);assert.equal(work.bytes,pages.reduce((n,p)=>n+Buffer.byteLength(p.data),0));
 for(const p of pages){assert.equal(p.value.bytes,Buffer.byteLength(p.data));assert.equal(p.value.hash,hash(p.value.entries));}
 const assignmentGuard=pages.flatMap(p=>p.value.entries).find(e=>e.assignmentTuple);assert.deepEqual(assignmentGuard.assignmentTuple,['assignment','assignment','pack','GEN',1,1,2,3]);
 const sources=pages.find(p=>p.value.family==='sources').value.entries;assert.equal(sources[0].textHash,hash('Raw text'));assert.equal(sources[0].parentKey,'chapter:pack:GEN:1');
});
test('retains exact fractional UTC locks while mapping canonical millisecond semantics',async()=>{
 const exact='2026-09-12T06:00:00.1234567-04:00';
 const r=await mapRoom({...terminal,submissions:[{...terminal.submissions[0],responseLockedAtUtc:exact,elapsedTicks:1234567}]});
 const s=r.rooms[0].room.submissions[0];assert.equal(s.responseLockedAtMs,Date.parse(exact));assert.equal(s.elapsedMs,123.4567);
 assert.equal(r.rooms[0].room.canonicalProvenance.submissionTimes[0].responseLockedAtUtc,exact);assert.equal(r.rooms[0].room.canonicalProvenance.submissionTimes[0].elapsedTicks,'1234567');assert.equal(s.canonicalProvenance,undefined);
 const saved=await map([row('pbe-attempt',{...attempt,responseLockedAtUtc:exact,sessionId:'session',...versions})]);
 assert.equal(JSON.parse(saved.records[0].data).responseLockedAtMs,Date.parse(exact));assert.equal(JSON.parse(saved.records[0].data).canonicalProvenance.responseLockedAtUtc,exact);
});
test('retains monotonic int64 lexical precision without pretending it is native wall time',async()=>{
 const raw=JSON.stringify(terminal).replace('"phaseTimestamp":123','"phaseTimestamp":9223372036854775807').replace('"responseTimestamp":234','"responseTimestamp":9223372036854775806');
 const result=await mapCanonicalPbe({snapshot:{tables:{PracticeRoomRecord:[{...roomRow(terminal),StateJson:raw}]}},nativeCore:{records:[]}});
 assert.equal(result.rooms[0].room.canonicalProvenance.phaseTimestamp,'9223372036854775807');
 assert.equal(result.rooms[0].room.lastObserved,Date.parse(at));assert.equal(result.rooms[0].room.epoch,'original-process');
});
test('keeps original monotonic draft ingress ticks private instead of mapping them as wall milliseconds',async()=>{
 const raw=JSON.stringify({...terminal,draftReceivedAt:{1:123,2:234}}).replace('"2":234','"2":9223372036854775807');
 const result=await mapCanonicalPbe({snapshot:{tables:{PracticeRoomRecord:[{...roomRow(terminal),StateJson:raw}]}},nativeCore:{records:[]}}),r=result.rooms[0].room;
 assert.equal(r.draftReceivedAt,undefined);assert.deepEqual(r.canonicalProvenance.draftReceivedAt,{'1':'123','2':'9223372036854775807'});assert.deepEqual(r.drafts,terminal.drafts);
 await assert.rejects(mapRoom({...terminal,draftReceivedAt:{1:'123'}}),/integer|scalar/);
});
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
let product;
async function productCodecs(){
 if(!product){const require=createRequire(new URL('../apps/web/package.json',import.meta.url)),{build}=require('esbuild');const output=await build({stdin:{contents:"export {RoomCodec} from './room-storage';export {view,applyCommand} from './state';export {summarizeRoom} from './room-history';",resolveDir:fileURLToPath(new URL('../apps/web/worker/native/practice',import.meta.url)),sourcefile:'mapping-pure-codecs.ts',loader:'ts'},bundle:true,write:false,platform:'node',format:'esm',metafile:true});assert.ok(Object.keys(output.metafile.inputs).every(p=>!p.includes('test-runtime')&&!p.includes('/maintenance/')));product=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));}return product;
}
test('real RoomCodec retains original authority and public Room.view omits provider metadata',async()=>{
 const commandId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';const {RoomCodec,view,applyCommand,summarizeRoom}=await productCodecs(),r=(await mapRoom({...terminal,appliedCommands:{...terminal.appliedCommands,[commandId]:owner}})).rooms[0].room;
 const encoded=await new RoomCodec().encode(r),decoded=await new RoomCodec().decode(encoded.manifest,h=>encoded.nodes.get(h)??null);assert.deepEqual(decoded,r);
 const actor={userId:owner,organizationId:org,displayName:'Original name',kind:'Student',role:'Student'},before=JSON.stringify(decoded);
 applyCommand(decoded,actor,{commandId,revision:51,action:'submit'},0,0);assert.equal(JSON.stringify(decoded),before);
 assert.throws(()=>applyCommand(decoded,{...actor,userId:'other'},{commandId,revision:51,action:'submit'},0,0),/denied|belongs/);
 const publicView=view(decoded,actor,Date.parse(at));assert.ok(!JSON.stringify(publicView).includes('canonicalProvenance'));assert.ok(!JSON.stringify(publicView).includes('phaseTimestamp'));assert.ok(!JSON.stringify(summarizeRoom(decoded)).includes('canonicalProvenance'));
 assert.deepEqual(decoded.canonicalProvenance.draftReceivedAt,{'1':String(Date.parse(at))});assert.ok(!JSON.stringify(publicView).includes('draftReceivedAt'));
 const history={...decoded,messages:[],drafts:{},applied:{}};const saved=await new RoomCodec().encode(history);const reloaded=await new RoomCodec().decode(saved.manifest,h=>saved.nodes.get(h)??null);assert.deepEqual(reloaded.applied,{});assert.deepEqual(reloaded.canonicalProvenance,decoded.canonicalProvenance);
});
test('rejects lost indexed answer correspondence and inconsistent frozen rubric identities',async()=>{
 await assert.rejects(map([row('pbe-session',{...session,attempts:[{...attempt,answers:['Two']}]})]),/answer|correspond/);
 await assert.rejects(mapRoom({...terminal,questions:[{...practiceQ,prompt:'different'}]}),/mismatch/);
});
test('rejects unknown chapter tuple, stale source proof, corrupt accounting and unsupported cursor before conversion',async()=>{
 for(const alter of [f=>{const r=f.snapshot.tables.PbeTrainingRecords[0];const v=JSON.parse(r.DataJson);v.push(JSON.stringify(['future','opaque']));r.DataJson=JSON.stringify(v);},f=>{f.nativeCore.records.find(r=>r.kind==='source').data.canonicalText='Changed';},f=>{const r=f.snapshot.tables.PbeTrainingRecords[1];const w=JSON.parse(r.DataJson);w.stagedBytes++;r.DataJson=JSON.stringify(w);},f=>{const r=f.snapshot.tables.PbeTrainingRecords[1];const w=JSON.parse(r.DataJson);w.capturePhase='sources';r.DataJson=JSON.stringify(w);}]){const f=chapterFixture();alter(f);await assert.rejects(mapCanonicalPbe(f),/unsupported|guard|accounting/);}
});
const retained={id:'review',targetId:'t',review:{targetId:'t',intervalIndex:1,dueAtMs:0,unresolved:false,lastAttemptId:null,lastQuestionId:null,lastSuccessfulAtMs:null},acceptedSequence:2,failedSequence:null,lastAnsweredQuestionId:'q',lastAnsweredQuestionKind:'ExactWords',provisional:false,pendingCount:0,evidenceGeneration:null,retention:{ruleVersion:'pbe-retention-v1',practiced:true,recalled:true,pendingCount:0,lastAcceptedSequence:2,lastFailureSequence:null,earliest:witness,latest:witness,witness,dataGap:false}};
const ev={attemptId:'a',targetId:'t',questionId:'q',atMs:Date.parse(at),earnedPoints:1,availablePoints:2,unaided:false,recall:true};
const dispute={id:'dispute',organizationId:org,seasonId:season,activity:'Solo',sessionId:'session',attemptId:'attempt',questionId:q.id,questionVersion:q.version,team:null,status:'Resolved',reason:'Review raw slots',revision:2,partPoints:[1,1],sourceEvidence:q.evidence,question:q,answers:['','Two'],originalPointsByPart:[0,1],acceptedAtUtc:at,participantIds:[owner],allParticipantIds:[owner],resolution:{pointsByPart:[1,1],reason:'Coach reviewed exact frozen parts',resolvedBy:'coach',resolvedAtUtc:at}};
const kindFixtures={
 'pbe-target':{id:'t',sourceUnitIds:['s'],skill:'ExactWords',label:'Opaque'},
 'pbe-question':{id:'q:2',seasonId:season,published:true,sourceFingerprint:'frozen',question:q},
 'pbe-question-head':{id:'q:2',seasonId:season,published:true,sourceFingerprint:'frozen',question:q},
 'pbe-introduction':{id:'intro',organizationId:org,seasonId:season,bookKey:'GEN',sourceEdition:'Original',title:'Title',citation:'Page 1',licensingStatus:'approved',reviewed:true,units:[{id:'unit',citation:'1',canonicalText:'Keep é'}]},
 'pbe-introduction-assignment':{id:'intro-assignment',seasonId:season,contentPackId:'intro',studentUserId:owner},
 'pbe-session':session,
 'pbe-attempt':{...attempt,sessionId:'session',...versions},
 'pbe-session-start':{sessionId:'session',...versions},
 'pbe-target-review':retained,
 'pbe-question-service':{id:'service',subjectId:'q',servedCount:1,lastServedAtMs:Date.parse(at),lastQuestionId:'q',lastQuestionKind:'ExactWords'},
 'pbe-target-service':{id:'service',subjectId:'t',servedCount:1,lastServedAtMs:Date.parse(at),lastQuestionId:'q',lastQuestionKind:'ExactWords'},
 'pbe-service-event':{id:'service',event:{serviceId:'service',questionId:'q',targetIds:['t'],questionKind:'ExactWords',atMs:Date.parse(at)}},
 'pbe-room-service-event':{id:'service',questionId:'q',questionKind:'ExactWords',targetIds:['t'],memberIds:[owner],atMs:Date.parse(at)},
 'pbe-recall-sequence':{id:'sequence',acceptedSequence:2,lastAtMs:Date.parse(at),recentTargets:[{targetId:'t',acceptedSequence:2}]},
 'pbe-recall-event':{id:'event',scopeVersion:'frozen',acceptedSequence:2,questionKind:'ExactWords',evidence:[ev],questionVersion:null,responseLockedAtMs:null},
 'pbe-evidence-ref':{id:'ref',eventId:'event',attemptRecordId:'a',acceptedSequence:2,questionKind:'ExactWords',evidence:ev,questionVersion:null,responseLockedAtMs:null},
 'pbe-evidence-index':{id:'index',ready:false,after:'KeepCase',coveredLegacyEvents:1},
 'pbe-evidence-dirty':{id:'dirty',targetId:'t',generation:7,completedGeneration:5},
 'pbe-attempt-review':{id:'review',questionId:'q',status:'Resolved',pointsByTarget:{TargetCase:1,targetCase:0}},
 'pbe-evidence-replay':{id:'replay',generation:7,after:'KeepCase',projection:retained,pendingCount:1,missingReferenceRepairAttempted:true},
 'pbe-dispute':dispute,
 'pbe-dispute-pending':{...dispute,status:'Pending',resolution:null},
 'pbe-dispute-correction':dispute,
 'pbe-grade-adjustment':{id:'adjustment',disputeId:'dispute',activity:'Solo',sessionId:'session',attemptId:'attempt',questionId:'q',questionVersion:2,team:null,pointsByPart:[1,1],reason:'Reason',resolvedBy:'coach',resolvedAtUtc:at,originalAcceptedAtUtc:at},
 'pbe-result-overlay':{id:'Solo:session',activity:'Solo',sessionId:'session',entries:{AttemptABC:{id:'dispute',status:'Resolved',revision:2,questionId:'q',questionVersion:2,pointsByPart:[1,1]},attemptABC:{id:'dispute2',status:'Pending',revision:1,questionId:'q',questionVersion:2,pointsByPart:null}}},
 'pbe-daily-mission':{id:'mission',...versions,seasonId:season,sessionId:'session',scopeVersion:'frozen',localDate:'2026-09-12',timeZone:'UTC',mode:'Practice',target:8,completed:1},
 'pbe-daily-mission-head':{id:'head',missionId:'mission',...versions},
};
test('maps canonical participant ownership to native dispute discovery indexes with original data unchanged',async()=>{
 for(const activity of ['Solo','Team']){const value={...dispute,activity,status:'Pending',resolution:null},source=row('pbe-dispute-pending',value);const result=await map([source]);assert.equal(result.records[0].owner_id,activity);assert.equal(result.records[0].data,source.DataJson);}
 const source=row('pbe-dispute-correction',dispute),result=await map([source]);assert.equal(result.records[0].owner_id,'Solo');assert.equal(result.records[0].data,source.DataJson);
 await assert.rejects(map([{...source,OwnerId:'another-user'}]),/owner/);
 await assert.rejects(map([row('pbe-dispute-correction',{...dispute,activity:'Team'})]),/correction/);
});
for(const [kind,value] of Object.entries(kindFixtures))test(`strict known-kind mapping ${kind} preserves frozen data and rejects unknown fields`,async()=>{
 const source=row(kind,value),result=await map([source]);assert.equal(result.records[0].revision,7);assert.equal(result.records[0].kind,kind);
 if(!['pbe-session','pbe-attempt'].includes(kind))assert.equal(result.records[0].data,source.DataJson);
 await assert.rejects(map([row(kind,{...value,unknownOperationalField:'stop'})]),/field/);
});
test('rejects an omitted assigned source from a supposedly captured generation',async()=>{
 const f=chapterFixture(),original=f.nativeCore.records.find(r=>r.kind==='source');f.nativeCore.records.push({...original,id:'source2',data:{...original.data,id:'source2',chapter:2,verse:1,citation:'GEN 2:1'}});
 await assert.rejects(mapCanonicalPbe(f),/source.*set|incomplete/);
});
test('does not coerce similarly named numeric dictionary entries into command owners',async()=>{
 await assert.rejects(mapRoom({...terminal,appliedCommands:{phaseTimestamp:42}}),/dictionary|expected string|scalar/);
});
function mutateWork(f,fn){const r=f.snapshot.tables.PbeTrainingRecords.find(r=>r.Kind==='pbe-chapter-work'),w=JSON.parse(r.DataJson);fn(w);r.DataJson=JSON.stringify(w);}
const chapterGroup={key:'chapter:pack:GEN:1',parentChapterKey:null,kind:'Chapter',contentPackId:'pack',bookKey:'GEN',chapter:1,assignedPassages:1,label:'GEN 1',scopeLabel:'1 assigned verses',sortKey:'GEN:00000001:pack:00000000:chapter:pack:GEN:1'};
const chapterCounts={assignedPassages:1,questionCoveredPassages:1,totalTargets:1,practicedTargets:1,recalledTargets:1,retainedTargets:0,dueTargets:1,missingVariantTargets:1};
test('preserves pending original aggregate and proof offsets while recomputing only codec byte charges',async()=>{
 const f=chapterFixture();f.snapshot.tables.PbeTrainingRecords.push(row('pbe-chapter-stamp-proof',proof,proofId,1));
 mutateWork(f,w=>{w.aggregate={group:chapterGroup,targetAfter:'t',counts:chapterCounts,updating:false,repair:false};w.proofPages=1;w.proofOffset=1;w.proofBytes=Buffer.byteLength(JSON.stringify(proof));w.stagedBytes+=w.proofBytes;});
 const out=await mapCanonicalPbe(f),w=JSON.parse(out.records.find(r=>r.kind==='pbe-chapter-work').data),p=out.records.find(r=>r.kind==='pbe-chapter-stamp-proof');
 assert.equal(w.proofOffset,1);assert.equal(w.proofBytes,Buffer.byteLength(p.data));assert.equal(w.aggregate.targetAfter,'t');assert.deepEqual(w.aggregate.counts,chapterCounts);assert.deepEqual(JSON.parse(p.data).entries,proofEntries);
 assert.equal(w.bytes,out.records.filter(r=>['pbe-chapter-manifest','pbe-chapter-stamp-proof'].includes(r.kind)).reduce((n,r)=>n+Buffer.byteLength(r.data),0));
});
for(const [phase,stage] of [['replay','Replaying'],['retentions','Retentions'],['seal','Projecting']])test(`preserves ${phase} generation and semantic cursor into ${stage}`,async()=>{
 const f=chapterFixture();mutateWork(f,w=>{w.capturePhase=phase;w.scopeVersion=null;w.after=phase==='seal'?'':'t';});
 const mapped=await mapCanonicalPbe(f),w=JSON.parse(mapped.records.find(r=>r.kind==='pbe-chapter-work').data);assert.equal(w.workId,gen);assert.equal(w.stage,stage);assert.equal(w.after,phase==='seal'?'':'t');assert.equal(w.scopeVersion,null);
});
for(const phase of ['scope','assignment','assignment-scope','intro-assignment','introduction','pack','member','sources','targets','questions'])test(`explicitly rejects unrepresentable early cursor ${phase}`,async()=>{const f=chapterFixture();mutateWork(f,w=>w.capturePhase=phase);await assert.rejects(mapCanonicalPbe(f),/early capture cursor/);});
for(const [field,value] of [['state','Blocked'],['abandonedId','old-generation'],['proofFingerprint','unknown']])test(`explicitly rejects unrepresentable saved ${field}`,async()=>{const f=chapterFixture();mutateWork(f,w=>w[field]=value);await assert.rejects(mapCanonicalPbe(f),/unsupported/);});
test('a second canonical AssignmentScope rejects the entire mapping',async()=>{const f=chapterFixture();f.snapshot.tables.AssignmentScopes.push({...f.snapshot.tables.AssignmentScopes[0],Id:'second'});await assert.rejects(mapCanonicalPbe(f),/exactly one scope/);});
test('maps immutable chapter projections with original row identity, evidence fingerprint and published counts',async()=>{
 const value={row:{key:chapterGroup.key,parentChapterKey:null,kind:'Chapter',label:'GEN 1',scopeLabel:'Whole assigned chapter',contentPackId:'pack',bookKey:'GEN',chapter:1,wholeChapterAssigned:true,counts:chapterCounts,currentReadiness:'Incomplete',stamp:null,hasHistoricalStamps:false,actions:[]},evidenceFingerprint:'OriginalCaseFingerprint'};
 const result=await map([row('pbe-chapter-projection',value,`${gen}:000000`,1)]),saved=JSON.parse(result.records[0].data);assert.deepEqual(saved.row,value.row);assert.equal(saved.id,`${gen}:000000`);assert.equal(saved.generationId,gen);assert.equal(saved.canonicalProvenance.evidenceFingerprint,value.evidenceFingerprint);
});
test('rejects Complete work whose published group rows are missing',async()=>{const f=chapterFixture();mutateWork(f,w=>{w.state='Complete';w.stage=null;w.snapshotId=gen;});await assert.rejects(mapCanonicalPbe(f),/complete.*projection|published/);});
test('maps Complete work and full immutable chapter/group row set without changing snapshot identity',async()=>{
 const f=chapterFixture(),groupKey='group:chapter:pack:GEN:1:source:source';
 const rows=[{key:chapterGroup.key,parentChapterKey:null,kind:'Chapter',label:'GEN 1',scopeLabel:'Whole assigned chapter',contentPackId:'pack',bookKey:'GEN',chapter:1,wholeChapterAssigned:true,counts:chapterCounts,currentReadiness:'Incomplete',stamp:null,hasHistoricalStamps:false,actions:[]},{key:groupKey,parentChapterKey:chapterGroup.key,kind:'PassageGroup',label:'GEN 1:1',scopeLabel:'1 assigned verses',contentPackId:'pack',bookKey:'GEN',chapter:1,wholeChapterAssigned:null,counts:chapterCounts,currentReadiness:'Incomplete',stamp:null,hasHistoricalStamps:false,actions:[]}];
 rows.forEach((value,i)=>f.snapshot.tables.PbeTrainingRecords.push(row('pbe-chapter-projection',{row:value,evidenceFingerprint:'original'},`${gen}:${String(i).padStart(6,'0')}`,1)));
 mutateWork(f,w=>{w.state='Complete';w.stage=null;w.snapshotId=gen;w.rowOffset=2;w.groupAfter=`GEN:00000001:pack:00000001:${groupKey}`;});
 const mapped=await mapCanonicalPbe(f),w=JSON.parse(mapped.records.find(r=>r.kind==='pbe-chapter-work').data);assert.equal(w.stage,'Complete');assert.equal(w.snapshotId,gen);assert.equal(w.rowIndex,2);assert.deepEqual(mapped.records.filter(r=>r.kind==='pbe-chapter-projection').map(r=>JSON.parse(r.data).row),rows);
});
