import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateNativePbeRecords} from './lib/cloudflare-native-pbe-validation.mjs';
import {mapCanonicalPbe} from './lib/cloudflare-pbe-mapping.mjs';
const org='org',season='season',owner='owner',at='2026-09-12T10:00:00.1234567+00:00';
const row=(kind,value,id=value.id??kind)=>({kind,id,org_id:org,season_id:season,owner_id:owner,data:JSON.stringify(value),revision:7});
const target={id:'t',sourceUnitIds:['source'],skill:'ExactWords',label:'Original'};
const q={schemaVersion:2,id:'q',version:2,contentPackId:'pack',sourceUnitId:'source',sourceUnitIds:['source'],sourceKind:'Scripture',reference:'GEN 1:1',evidence:'Text',kind:'ExactWords',prompt:'Two blanks',ordered:true,parts:[{targetId:'t',acceptedAnswers:['One'],points:1},{targetId:'t',acceptedAnswers:['Two'],points:1}]};
const versions={format:'Pbe',ruleVersion:'nad-pbe-2023-24-v2',scoringVersion:'pbe-rubric-v2',selectionVersion:'pbe-selection-v1'};
const attempt={id:'a',cardId:'card',clientSubmissionId:'OpaqueCase',answers:['','Two'],hintsUsed:false,atMs:100,responseLockedAtMs:100,result:{attemptId:'a',earnedPoints:1,availablePoints:2,expectedParts:['One','Two'],sourceEvidence:'Text',citation:'GEN 1:1',unaided:true,acceptedAtUtc:at,acceptedSequence:1,alreadyProcessed:false}};
const session={id:'session',studentUserId:owner,seasonId:season,...versions,mode:'Practice',status:'Active',scopeVersion:'frozen',questionIds:['q'],cards:[{id:'card',question:q,targets:[target],servedAtMs:50,assistedAtMs:null}],attempts:[attempt],createdAtUtc:at,startPayload:'original',missionLocalDate:null,creditedLocalDate:null,newlyCreditedDay:false};
const work={id:'owner:season',workId:'generation',schemaVersion:1,seasonId:season,baseGuards:[{kind:'membership',id:'season:owner',revision:1}],sourceHash:'originalHash',stage:'Sources',offset:0,after:'',pageCount:0,bytes:0,scopeVersion:null,asOfUtc:at,dueRefreshAtUtc:at,reason:null,snapshotId:null,abandoned:'old-generation',rowIndex:0,proofOffset:0,groupAfter:'',aggregate:null};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function page(family,entries){const v={id:`generation:${family}:000000`,generationId:'generation',family,ordinal:0,entries,bytes:0,hash:hash(entries)};while(v.bytes!==Buffer.byteLength(JSON.stringify(v)))v.bytes=Buffer.byteLength(JSON.stringify(v));return v;}
function checkUntouched(records){const before=JSON.stringify(records);assert.equal(validateNativePbeRecords(records),undefined);assert.equal(JSON.stringify(records),before);}
test('preserves exact native JSON bytes, indexed empties and unknown non-PBE raw answer forms',()=>{
 const r=row('pbe-target',target);r.data='{ "id":"t", "sourceUnitIds":["source"], "skill":"ExactWords", "label":"\\u0041" }';checkUntouched([r,row('pbe-session',session),row('pbe-attempt',{...attempt,sessionId:'session',...versions}),row('attempt',{answer:'Legacy string',answerPayload:{answers:['','Two']},unrelated:'outside PBE schema'})]);
});
test('rejects unsupported PBE kinds, schema versions and fields',()=>{
 for(const r of [row('pbe-progress',{}),row('pbe-cooperation-work',{}),row('pbe-target',{...target,unknown:1}),row('pbe-question',{id:'q:2',seasonId:season,published:true,sourceFingerprint:'f',question:{...q,schemaVersion:3}})])assert.throws(()=>validateNativePbeRecords([r]),/unsupported|field|version/);
});
test('rejects unsafe scalar/revision and timed sessions including completed recaps',()=>{
 for(const r of [{...row('pbe-target',target),revision:0},{...row('pbe-target',target),data:'{"id":"t","sourceUnitIds":[],"skill":"ExactWords","label":9223372036854775807}'},row('pbe-session',{...session,mode:'Simulation',status:'Completed'}),row('pbe-session',{...session,timing:{status:'Armed'}})])assert.throws(()=>validateNativePbeRecords([r]),/integer|scalar|unsupported|field/);
});
test('rejects broken internal frozen card/answer/result correspondence',()=>{
 for(const value of [{...session,questionIds:['another']},{...session,attempts:[{...attempt,answers:['Two']}]},{...session,attempts:[{...attempt,result:{...attempt.result,attemptId:'other'}}]}])assert.throws(()=>validateNativePbeRecords([row('pbe-session',value)]),/correspondence/);
});
test('accepts native early capture, cleanup, blocked reason and optional proof subtotal untouched',()=>{
 for(const stage of ['Sources','Guards','Targets','Heads','Groups','Replaying','Retentions','Projecting','Proofs','Complete','Cleanup'])checkUntouched([row('pbe-chapter-work',{...work,stage,reason:'DataGap',proofBytes:0})]);
});
test('preserves only InputTooLarge planned byte tail at the native page boundary',()=>{
 const cap=16*1024*1024,pageCap=65536;
 for(const bytes of [cap,cap+1,cap+pageCap])checkUntouched([row('pbe-chapter-work',{...work,reason:'InputTooLarge',bytes,proofBytes:cap})]);
 for(const value of [{...work,reason:'InputTooLarge',bytes:cap+pageCap+1},{...work,reason:null,bytes:cap+1},{...work,reason:'DataGap',bytes:cap+1},{...work,reason:'InputTooLarge',bytes:cap,proofBytes:cap+1}])assert.throws(()=>validateNativePbeRecords([row('pbe-chapter-work',value)]),/byte accounting/);
});
test('rejects malformed manifest family/entries/seal and unknown work stages',()=>{
 for(const r of [row('pbe-chapter-work',{...work,stage:'Future'}),row('pbe-chapter-manifest',page('future',[])),row('pbe-chapter-manifest',page('sources',[{id:'source'}])),row('pbe-chapter-manifest',{...page('guards',[]),hash:'wrong'})])assert.throws(()=>validateNativePbeRecords([r]),/unsupported|missing|seal|hash/);
});
test('preserves canonical mapped lock provenance without admitting raw canonical timing fields',async()=>{
 const {responseLockedAtMs,...originalAttempt}=attempt,canonical={...originalAttempt,responseLockedAtUtc:at,sessionId:'session',...versions};
 const source={OrganizationId:org,SeasonId:season,OwnerId:owner,Kind:'pbe-attempt',Id:'a',Revision:7,DataJson:JSON.stringify(canonical)};
 const mapped=await mapCanonicalPbe({snapshot:{tables:{PbeTrainingRecords:[source]}},nativeCore:{records:[]}});checkUntouched(mapped.records);
 assert.throws(()=>validateNativePbeRecords([row('pbe-attempt',{...attempt,sessionId:'session',...versions,responseLockedAtUtc:at})]),/field/);
});
const candidate={targetId:'t',questionId:'q',questionVersion:2,attemptId:'a',atMs:100,acceptedSequence:1},second={...candidate,questionId:'q2',attemptId:'a2',atMs:172800100,acceptedSequence:2};
const retention={ruleVersion:'pbe-retention-v1',practiced:true,recalled:true,pendingCount:0,lastAcceptedSequence:2,lastFailureSequence:null,earliest:[candidate,second],latest:[second,candidate],witness:[candidate,second],dataGap:false};
const projection={id:'owner:season:t',targetId:'t',review:{targetId:'t',intervalIndex:1,dueAtMs:200,unresolved:false,lastAttemptId:'a',lastQuestionId:'q',lastSuccessfulAtMs:100},acceptedSequence:1,failedSequence:null,lastAnsweredQuestionId:'q',lastAnsweredQuestionKind:'ExactWords',provisional:true,pendingCount:1,evidenceGeneration:7,retention};
const evidence={attemptId:'a',targetId:'t',questionId:'q',atMs:100,earnedPoints:1,availablePoints:2,unaided:false,recall:true};
const dispute={id:'Solo:session:a',organizationId:org,seasonId:season,activity:'Solo',sessionId:'session',attemptId:'a',questionId:'q',questionVersion:2,team:null,status:'Resolved',reason:'Original',revision:2,partPoints:[1,1],sourceEvidence:q.evidence,question:q,answers:['','Two'],originalPointsByPart:[0,1],acceptedAtUtc:at,participantIds:[owner],allParticipantIds:[owner],resolution:{pointsByPart:[1,1],reason:'Resolution',resolvedBy:'coach',resolvedAtUtc:at}};
const fixtures={
 'pbe-target':target,
 'pbe-question':{id:'q:2',seasonId:season,published:true,sourceFingerprint:'OriginalCase',question:q},
 'pbe-question-head':{id:'q:2',seasonId:season,published:true,sourceFingerprint:'OriginalCase',question:q},
 'pbe-introduction':{id:'intro',organizationId:org,seasonId:season,bookKey:'GEN',sourceEdition:'Original',title:'Title',citation:'Citation',licensingStatus:'approved',reviewed:true,units:[{id:'unit',citation:'1',canonicalText:'Original text'}]},
 'pbe-introduction-assignment':{id:'intro-assignment',seasonId:season,contentPackId:'intro',studentUserId:owner},
 'pbe-session':session,
 'pbe-attempt':{...attempt,sessionId:'session',...versions},
 'pbe-session-start':{sessionId:'session',...versions},
 'pbe-target-review':projection,
 'pbe-question-service':{id:'service',subjectId:'q',servedCount:1,lastServedAtMs:100,lastQuestionId:'q',lastQuestionKind:'ExactWords'},
 'pbe-target-service':{id:'service',subjectId:'t',servedCount:1,lastServedAtMs:100,lastQuestionId:'q',lastQuestionKind:'ExactWords'},
 'pbe-service-event':{id:'service',event:{serviceId:'service',questionId:'q',targetIds:['t'],questionKind:'ExactWords',atMs:100}},
 'pbe-room-service-event':{id:'service',questionId:'q',questionKind:'ExactWords',targetIds:['t'],memberIds:[owner],atMs:100},
 'pbe-recall-sequence':{id:'owner:season',acceptedSequence:1,lastAtMs:100,recentTargets:[{targetId:'t',acceptedSequence:1}]},
 'pbe-recall-event':{id:'event',scopeVersion:'original',acceptedSequence:1,questionKind:'ExactWords',evidence:[evidence]},
 'pbe-evidence-ref':{id:'ref',eventId:'event',attemptRecordId:'a',acceptedSequence:1,questionKind:'ExactWords',evidence},
 'pbe-evidence-index':{id:'index',ready:false,after:'OriginalCursor',coveredLegacyEvents:0},
 'pbe-evidence-dirty':{id:'dirty',targetId:'t',generation:8,completedGeneration:6},
 'pbe-attempt-review':{id:'review',questionId:'q',status:'Resolved',pointsByTarget:JSON.parse('{"TargetCase":1,"targetCase":0,"__proto__":2}')},
 'pbe-evidence-replay':{id:'replay',generation:7,after:'original:',projection,pendingCount:1,missingReferenceRepairAttempted:true},
 'pbe-dispute':dispute,
 'pbe-dispute-pending':{...dispute,status:'Pending',resolution:null},
 'pbe-dispute-correction':dispute,
 'pbe-grade-adjustment':{id:'adjustment',disputeId:dispute.id,activity:'Solo',sessionId:'session',attemptId:'a',questionId:'q',questionVersion:2,team:null,pointsByPart:[1,1],reason:'Resolution',resolvedBy:'coach',resolvedAtUtc:at,originalAcceptedAtUtc:at},
 'pbe-result-overlay':{id:'Solo:session',activity:'Solo',sessionId:'session',entries:{AttemptCase:{id:dispute.id,status:'Resolved',revision:2,questionId:'q',questionVersion:2,pointsByPart:[1,1]}}},
 'pbe-daily-mission':{id:'mission',...versions,seasonId:season,sessionId:'session',scopeVersion:'original',localDate:'2026-09-12',timeZone:'UTC',mode:'Review',target:8,completed:1},
 'pbe-daily-mission-head':{id:'head',missionId:'mission',...versions},
 'pbe-solo-interruption':{sessionId:'interrupted',questionId:'q',status:'Interrupted',restartAllowed:true},
};
for(const [kind,value] of Object.entries(fixtures))test(`explicit native ${kind} shape and unknown-field rejection`,()=>{const r=row(kind,value);if(kind==='pbe-solo-interruption')r.season_id=null;checkUntouched([r]);assert.throws(()=>validateNativePbeRecords([row(kind,{...value,unsupportedField:1})]),/field/);});
const group={key:'chapter:pack:GEN:1',parentChapterKey:null,kind:'Chapter',contentPackId:'pack',bookKey:'GEN',chapter:1,wholeChapterAssigned:false,assignedPassages:1,sortKey:'OriginalSort',label:'GEN 1',scopeLabel:'1 assigned verse'};
const counts={assignedPassages:1,questionCoveredPassages:1,totalTargets:1,practicedTargets:1,recalledTargets:1,retainedTargets:1,dueTargets:0,missingVariantTargets:0};
const summary={stampId:'stamp',chapterKey:group.key,kind:'Chapter',label:'GEN 1',scopeLabel:'Original assignment',scopeVersion:'original',ruleVersion:'pbe-chapter-v1',earnedAtUtc:at,matchesCurrentScope:null};
const progressRow={key:group.key,parentChapterKey:null,kind:'Chapter',label:'GEN 1',scopeLabel:'1 assigned verse',contentPackId:'pack',bookKey:'GEN',chapter:1,wholeChapterAssigned:true,counts,currentReadiness:'Retained',stamp:summary,hasHistoricalStamps:true,actions:[{mode:'Review',label:'Review',progressScope:{key:group.key,scopeVersion:'original'}}]};
const guard={kind:'pbe-target',id:'t',revision:7,ownerId:'source'};
const manifestFixtures={
 sources:[{id:'source',contentPackId:'pack',sourceKind:'Scripture',bookKey:'GEN',chapter:1,verse:1,ordinal:1,citation:'GEN 1:1',textHash:hash('Original'),parentKey:group.key,groupKey:null,guards:[{kind:'source',id:'source',revision:1},{kind:'pack',id:'pack',revision:1}]}],
 guards:[{kind:'assignment',id:'assignment',revision:1,assignmentTuple:['assignment','assignment','pack','GEN',1,1,2,3],introductionGuard:null},{kind:'@active-user',id:owner,revision:0},{kind:'membership',id:'season:owner',revision:null}],
 targets:[{guard,target:{id:'t',skill:'ExactWords',sourceUnitIds:['source']}},{guard:{...guard,id:'ineligible'},target:null}],
 heads:[{guard:{...guard,kind:'pbe-question-head'},question:{id:'q',version:2,sourceUnitIds:['source'],kind:'ExactWords',ordered:true,parts:[{targetId:'t',points:1}]}},{guard:{...guard,id:'ineligible',kind:'pbe-question-head'},question:null}],
 groups:[group],retentions:[{targetId:'t',projection}],evidence:[{kind:'pbe-target-review',id:projection.id,revision:7}],
};
for(const [family,entries] of Object.entries(manifestFixtures))test(`native manifest ${family} entries preserve original seals`,()=>{const r={...row('pbe-chapter-manifest',page(family,entries)),revision:1};checkUntouched([r]);assert.throws(()=>validateNativePbeRecords([{...r,data:JSON.stringify(page(family,[{...entries[0],unexpected:1}]))}]),/field/);});
test('preserves historical projection/stamp/proof without requiring current work or immutable references',()=>{
 const proof={id:'generation:proof-000000:000000',generationId:'generation',family:'proof-000000',entries:[{targetId:'t',witness:[candidate,second]}]};proof.hash=hash(proof.entries);
 const saved={id:'generation:000000',generationId:'generation',row:progressRow,canonicalProvenance:{version:1,evidenceFingerprint:'OpaqueOriginal'}};
 const stamp={id:'stamp',summary,proofGenerationId:'generation',proofFamily:proof.family,targetCount:1,qualifyingAttemptCount:2,proofPageCount:1,proofHash:hash([[proof.id,proof.hash]])};
 for(const [kind,value] of [['pbe-chapter-projection',saved],['pbe-chapter-stamp',stamp],['pbe-chapter-stamp-proof',proof]]){const r={...row(kind,value),revision:1};checkUntouched([r]);assert.throws(()=>validateNativePbeRecords([{...r,data:JSON.stringify({...value,unknown:1})}]),/field/);}
});
test('preserves native partial aggregate/repair/cleanup and optional/null legacy provenance',()=>{
 checkUntouched([row('pbe-chapter-work',{...work,stage:'Proofs',bytes:2048,proofBytes:1024,proofOffset:1,aggregate:{group,targetAfter:'t',counts,updating:true,repair:true}}),row('pbe-target-review',{...projection,retention:null,evidenceGeneration:null}),row('pbe-recall-event',{...fixtures['pbe-recall-event'],questionVersion:null,responseLockedAtMs:null}),row('pbe-evidence-ref',{...fixtures['pbe-evidence-ref'],questionVersion:2,responseLockedAtMs:100})]);
});
test('rejects unknown retention/provenance versions without changing supplied data',()=>{
 for(const r of [row('pbe-target-review',{...projection,retention:{...retention,ruleVersion:'future'}}),row('pbe-attempt',{...attempt,sessionId:'session',...versions,canonicalProvenance:{version:2,responseLockedAtUtc:at}})]){const before=JSON.stringify(r);assert.throws(()=>validateNativePbeRecords([r]),/unsupported/);assert.equal(JSON.stringify(r),before);}
});
test('rejects mismatched immutable chapter identities and proof target correspondence',()=>{
 const v={id:'generation:000000',generationId:'another-generation',row:progressRow};
 assert.throws(()=>validateNativePbeRecords([{...row('pbe-chapter-projection',v),revision:1}]),/identity|correspondence/);
 const entries=[{targetId:'another-target',witness:[candidate,second]}],proof={id:'generation:proof-000000:000000',generationId:'generation',family:'proof-000000',entries,hash:hash(entries)};
 assert.throws(()=>validateNativePbeRecords([{...row('pbe-chapter-stamp-proof',proof),revision:1}]),/target.*correspondence/);
});
