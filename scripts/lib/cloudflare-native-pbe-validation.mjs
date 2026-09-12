import {createHash} from 'node:crypto';
// Explicit native storage shapes. Shared rubric/evidence fields mirror accepted producer declarations.
// This module deliberately neither imports nor invokes canonical conversion.
const fail=message=>{throw new Error(`Native PBE validation blocked: ${message}`);};
const str=(v,p)=>{if(typeof v!=='string')fail(`${p}: expected string`);};
const bool=(v,p)=>{if(typeof v!=='boolean')fail(`${p}: expected boolean`);};
const num=(v,p)=>{if(typeof v!=='number'||!Number.isFinite(v))fail(`${p}: expected finite number`);};
const integer=(v,p)=>{if(!Number.isSafeInteger(v))fail(`${p}: expected safe integer`);};
const positive=(v,p)=>{integer(v,p);if(v<1)fail(`${p}: expected positive integer`);};
const lit=(...allowed)=>(v,p)=>{if(!allowed.includes(v))fail(`${p}: unsupported value/version ${String(v)}`);};
const nullable=f=>(v,p)=>{if(v!==null)f(v,p);};
const array=f=>(v,p)=>{if(!Array.isArray(v))fail(`${p}: expected array`);v.forEach((x,i)=>f(x,`${p}[${i}]`));};
const dict=f=>(v,p)=>{if(!v||typeof v!=='object'||Array.isArray(v))fail(`${p}: expected dictionary`);for(const [k,x] of Object.entries(v))f(x,`${p}[${JSON.stringify(k)}]`);};
const shape=(required,optional={})=>(v,p)=>{
 if(!v||typeof v!=='object'||Array.isArray(v))fail(`${p}: expected object`);
 for(const k of Object.keys(required))if(!Object.hasOwn(v,k))fail(`${p}: missing field ${k}`);
 for(const [k,x] of Object.entries(v)){const f=Object.hasOwn(required,k)?required[k]:Object.hasOwn(optional,k)?optional[k]:null;if(!f)fail(`${p}: unsupported field ${k}`);f(x,`${p}.${k}`);}
};
const fields=(names,f=str)=>Object.fromEntries(names.split(' ').filter(Boolean).map(k=>[k,f]));
const timestamp=(v,p)=>{str(v,p);if(!Number.isFinite(Date.parse(v)))fail(`${p}: invalid timestamp`);};
const strings=array(str),integers=array(integer),timeOrNull=nullable(timestamp),intOrNull=nullable(integer),stringOrNull=nullable(str);
function parse(text,label){
 str(text,label);
 try{return JSON.parse(text,(_key,value)=>{if(typeof value==='number'&&(!Number.isFinite(value)||Number.isInteger(value)&&!Number.isSafeInteger(value)))fail(`${label}: unsafe JSON numeric scalar`);return value;});}
 catch(error){if(error.message.startsWith('Native PBE validation blocked:'))throw error;fail(`${label}: invalid JSON`);}
}
const target=shape({...fields('id label'),sourceUnitIds:strings,skill:lit('FactualRecall','ExactWords')});
const part=shape({targetId:str,acceptedAnswers:strings,points:positive});
const question=shape({...fields('id contentPackId sourceUnitId reference evidence prompt'),schemaVersion:lit(2),version:positive,sourceUnitIds:strings,sourceKind:lit('Scripture','Commentary'),kind:lit('ShortAnswer','List','ExactWords','TrueFalse'),ordered:bool,parts:array(part)});
const bankQuestion=shape({...fields('id seasonId sourceFingerprint'),published:bool,question});
const candidate=shape({...fields('targetId questionId attemptId'),questionVersion:positive,atMs:integer,acceptedSequence:integer});
const retention=shape({ruleVersion:lit('pbe-retention-v1'),...fields('practiced recalled dataGap',bool),...fields('pendingCount lastAcceptedSequence',integer),lastFailureSequence:intOrNull,earliest:array(candidate),latest:array(candidate),witness:nullable((v,p)=>{array(candidate)(v,p);if(v.length!==2)fail(`${p}: expected witness pair`);})});
const review=shape({targetId:str,...fields('intervalIndex dueAtMs',integer),unresolved:bool,...fields('lastAttemptId lastQuestionId',stringOrNull),lastSuccessfulAtMs:intOrNull});
const projection=shape({...fields('id targetId lastAnsweredQuestionId'),review,acceptedSequence:integer,failedSequence:intOrNull,lastAnsweredQuestionKind:stringOrNull},{provisional:bool,pendingCount:integer,evidenceGeneration:intOrNull,retention:nullable(retention)});
const evidence=shape({...fields('attemptId targetId questionId'),...fields('atMs earnedPoints availablePoints',integer),unaided:bool,recall:bool});
const result=shape({...fields('attemptId sourceEvidence citation'),...fields('earnedPoints availablePoints acceptedSequence',integer),expectedParts:strings,unaided:bool,acceptedAtUtc:timestamp,alreadyProcessed:bool});
const attemptFields={...fields('id cardId clientSubmissionId'),answers:strings,hintsUsed:bool,atMs:integer,result};
const attemptOptional={responseLockedAtMs:integer,canonicalProvenance:shape({version:lit(1),responseLockedAtUtc:timestamp})};
const attempt=shape(attemptFields,attemptOptional);
const card=shape({id:str,question,targets:array(target),servedAtMs:intOrNull,assistedAtMs:intOrNull});
const versions={format:lit('Pbe'),ruleVersion:lit('nad-pbe-2023-24-v2'),scoringVersion:lit('pbe-rubric-v2'),selectionVersion:lit('pbe-selection-v1')};
const session=shape({...fields('id studentUserId seasonId scopeVersion startPayload'),...versions,mode:lit('Practice','Review'),status:lit('Created','Active','Completed'),questionIds:strings,cards:array(card),attempts:array(attempt),createdAtUtc:timestamp,missionLocalDate:stringOrNull,creditedLocalDate:stringOrNull,newlyCreditedDay:bool},{completedAtUtc:timeOrNull,clientStartId:stringOrNull});
const serviceProjection=shape({...fields('id subjectId lastQuestionId lastQuestionKind'),...fields('servedCount lastServedAtMs',integer)});
const serviceEvent=shape({...fields('serviceId questionId questionKind'),targetIds:strings,atMs:integer});
const roomService=shape({...fields('id questionId questionKind'),targetIds:strings,memberIds:strings,atMs:integer});
const resolution=shape({pointsByPart:integers,...fields('reason resolvedBy'),resolvedAtUtc:timestamp});
const dispute=shape({...fields('id organizationId seasonId sessionId attemptId questionId reason sourceEvidence'),activity:lit('Solo','Team'),questionVersion:positive,team:intOrNull,status:lit('Pending','Resolved'),revision:positive,partPoints:integers,question,answers:strings,originalPointsByPart:integers,acceptedAtUtc:timestamp,participantIds:strings,allParticipantIds:strings,resolution:nullable(resolution)});
const resultReview=shape({...fields('id questionId'),status:lit('Pending','Resolved'),revision:positive,questionVersion:positive,pointsByPart:nullable(integers)});
const schemas={
 'pbe-target':target,
 'pbe-question':bankQuestion,
 'pbe-question-head':bankQuestion,
 'pbe-introduction':shape({...fields('id organizationId seasonId bookKey sourceEdition title citation licensingStatus'),reviewed:bool,units:array(shape(fields('id citation canonicalText')))}),
 'pbe-introduction-assignment':shape(fields('id seasonId contentPackId studentUserId')),
 'pbe-session':session,
 'pbe-attempt':shape({...attemptFields,sessionId:str,...versions},attemptOptional),
 'pbe-session-start':shape({sessionId:str,...versions}),
 'pbe-target-review':projection,
 'pbe-question-service':serviceProjection,
 'pbe-target-service':serviceProjection,
 'pbe-service-event':shape({id:str,event:serviceEvent}),
 'pbe-room-service-event':roomService,
 'pbe-recall-sequence':shape({id:str,acceptedSequence:integer,lastAtMs:integer,recentTargets:array(shape({targetId:str,acceptedSequence:integer}))}),
 'pbe-recall-event':shape({...fields('id scopeVersion'),acceptedSequence:integer,questionKind:stringOrNull,evidence:array(evidence)},{questionVersion:intOrNull,responseLockedAtMs:intOrNull}),
 'pbe-evidence-ref':shape({...fields('id eventId attemptRecordId'),acceptedSequence:integer,questionKind:stringOrNull,evidence},{questionVersion:intOrNull,responseLockedAtMs:intOrNull}),
 'pbe-evidence-index':shape({...fields('id after'),ready:bool,coveredLegacyEvents:integer}),
 'pbe-evidence-dirty':shape({...fields('id targetId'),generation:integer,completedGeneration:integer}),
 'pbe-attempt-review':shape({...fields('id questionId'),status:lit('Pending','Resolved'),pointsByTarget:dict(integer)}),
 'pbe-evidence-replay':shape({...fields('id after'),generation:integer,projection,pendingCount:integer},{missingReferenceRepairAttempted:bool}),
 'pbe-dispute':dispute,
 'pbe-dispute-pending':dispute,
 'pbe-dispute-correction':dispute,
 'pbe-grade-adjustment':shape({...fields('id disputeId sessionId attemptId questionId reason resolvedBy'),activity:lit('Solo','Team'),questionVersion:positive,team:intOrNull,pointsByPart:integers,...fields('resolvedAtUtc originalAcceptedAtUtc',timestamp)}),
 'pbe-result-overlay':shape({...fields('id sessionId'),activity:lit('Solo','Team'),entries:dict(resultReview)}),
 'pbe-daily-mission':shape({...fields('id seasonId sessionId scopeVersion localDate timeZone'),...versions,mode:lit('Practice','Review'),target:integer,completed:integer}),
 'pbe-daily-mission-head':shape({...fields('id missionId'),...versions}),
};
const nonnegative=(v,p)=>{integer(v,p);if(v<0)fail(`${p}: expected nonnegative integer`);};
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hex=(v,p)=>{str(v,p);if(!/^[0-9a-f]{64}$/.test(v))fail(`${p}: invalid hash`);};
const guardFields={kind:lit('season','scope','membership','@active-user','assignment','pbe-introduction-assignment','pbe-introduction','source','pack','pbe-target','pbe-question-head','pbe-target-review'),id:str,revision:nullable(nonnegative)};
const guard=shape(guardFields,{ownerId:stringOrNull});
const assignmentTuple=(v,p)=>{
 if(!Array.isArray(v)||v.length!==8)fail(`${p}: unsupported assignment tuple`);
 lit('assignment','pbe-introduction-assignment')(v[0],p);str(v[1],p);str(v[2],p);nullable(str)(v[3],p);for(const n of v.slice(4))intOrNull(n,p);
};
const capturedGuard=shape(guardFields,{ownerId:stringOrNull,assignmentTuple,introductionGuard:nullable(guard)});
const groupFields={...fields('key label scopeLabel contentPackId bookKey'),parentChapterKey:stringOrNull,kind:lit('Chapter','PassageGroup','Introduction'),chapter:intOrNull,wholeChapterAssigned:nullable(bool)};
const group=shape({...groupFields,assignedPassages:nonnegative,sortKey:str});
const counts=shape(fields('assignedPassages questionCoveredPassages totalTargets practicedTargets recalledTargets retainedTargets dueTargets missingVariantTargets',nonnegative));
const summary=shape({...fields('stampId chapterKey label scopeLabel scopeVersion'),kind:lit('Chapter','Introduction'),ruleVersion:lit('pbe-chapter-v1'),earnedAtUtc:timestamp,matchesCurrentScope:nullable(bool)});
const progressRow=shape({...groupFields,counts,currentReadiness:lit('Retained','Incomplete','Updating'),stamp:nullable(summary),hasHistoricalStamps:bool,actions:array(shape({mode:lit('Practice','Review'),label:str,progressScope:shape(fields('key scopeVersion'))}))});
const aggregate=shape({group,targetAfter:str,counts,updating:bool,repair:bool});
const source=shape({...fields('id contentPackId bookKey citation textHash parentKey'),sourceKind:lit('Scripture','Commentary'),chapter:intOrNull,verse:intOrNull,ordinal:integer,groupKey:stringOrNull,guards:array(guard)});
const compactTarget=shape({id:str,skill:lit('FactualRecall','ExactWords'),sourceUnitIds:strings});
const compactQuestion=shape({id:str,version:positive,sourceUnitIds:strings,kind:lit('ShortAnswer','List','ExactWords','TrueFalse'),ordered:bool,parts:array(shape({targetId:str,points:positive}))});
const manifestEntries={sources:source,guards:capturedGuard,targets:shape({guard,target:nullable(compactTarget)}),heads:shape({guard,question:nullable(compactQuestion)}),groups:group,retentions:shape({targetId:str,projection}),evidence:guard};
Object.assign(schemas,{
 'pbe-chapter-work':shape({baseGuards:array(guard),groupAfter:str,aggregate:nullable(aggregate),...fields('id workId seasonId sourceHash'),schemaVersion:lit(1),stage:lit('Sources','Guards','Targets','Heads','Groups','Replaying','Retentions','Projecting','Proofs','Complete','Cleanup'),offset:nonnegative,after:str,pageCount:nonnegative,bytes:nonnegative,scopeVersion:stringOrNull,asOfUtc:timestamp,dueRefreshAtUtc:timestamp,reason:lit(null,'PbeDisabled','SeasonClosed','NoAssignment','DataGap','ScopeTooLarge','InputTooLarge'),snapshotId:stringOrNull,abandoned:stringOrNull,rowIndex:nonnegative,proofOffset:nonnegative},{proofBytes:nonnegative}),
 'pbe-chapter-manifest':shape({...fields('id generationId family'),ordinal:nonnegative,entries:array(()=>{}),bytes:nonnegative,hash:hex}),
 'pbe-chapter-projection':shape({...fields('id generationId'),row:progressRow},{canonicalProvenance:shape({version:lit(1),evidenceFingerprint:str})}),
 'pbe-chapter-stamp':shape({id:str,summary,...fields('proofGenerationId proofFamily'),...fields('targetCount qualifyingAttemptCount proofPageCount',nonnegative),proofHash:hex}),
 'pbe-chapter-stamp-proof':shape({...fields('id generationId family'),entries:array(shape({targetId:str,witness:(v,p)=>{array(candidate)(v,p);if(v.length!==2)fail(`${p}: expected witness pair`);}})),hash:hex}),
 'pbe-solo-interruption':shape({sessionId:str,questionId:str,status:lit('Interrupted'),restartAllowed:lit(true)}),
});
function attemptCorrespondence(a,card){
 if(a.id!==a.result.attemptId||card&&(a.answers.length!==card.question.parts.length||a.result.expectedParts.length!==card.question.parts.length))fail('frozen answer/result correspondence mismatch');
 if(a.canonicalProvenance&&Date.parse(a.canonicalProvenance.responseLockedAtUtc)!==a.responseLockedAtMs)fail('original lock provenance correspondence mismatch');
}
function correspondence(kind,v,r){
 if(kind.startsWith('pbe-chapter-')&&v.id!==r.id)fail('chapter record/body identity mismatch');
 if(kind==='pbe-chapter-projection'&&(!v.id.startsWith(`${v.generationId}:`)||!/^\d{6}$/.test(v.id.slice(v.id.lastIndexOf(':')+1))))fail('chapter projection generation identity mismatch');
 if(kind==='pbe-chapter-stamp'&&v.id!==v.summary.stampId)fail('chapter stamp summary identity mismatch');
 if(kind==='pbe-session'){
  if(JSON.stringify(v.questionIds)!==JSON.stringify(v.cards.map(c=>c.question.id)))fail('session question/card correspondence mismatch');
  const cards=new Set(),attempts=new Set(),commands=new Set();
  for(const c of v.cards){if(cards.has(c.id))fail('duplicate frozen card identity');cards.add(c.id);}
  for(const a of v.attempts){const c=v.cards.find(c=>c.id===a.cardId);if(!c)fail('session attempt/card correspondence mismatch');attemptCorrespondence(a,c);if(attempts.has(a.id)||commands.has(a.clientSubmissionId))fail('duplicate frozen attempt/command identity');attempts.add(a.id);commands.add(a.clientSubmissionId);}
 }
 if(kind==='pbe-attempt')attemptCorrespondence(v);
 if(['pbe-dispute','pbe-dispute-pending','pbe-dispute-correction'].includes(kind)){
  const n=v.question.parts.length;
  if(v.questionId!==v.question.id||v.questionVersion!==v.question.version||v.answers.length!==n||v.partPoints.length!==n||v.originalPointsByPart.length!==n||v.resolution&&v.resolution.pointsByPart.length!==n)fail('dispute frozen part correspondence mismatch');
  if(v.status==='Pending'?v.resolution!==null:v.resolution===null)fail('dispute resolution/status correspondence mismatch');
  if(kind==='pbe-dispute-pending'&&v.status!=='Pending'||kind==='pbe-dispute-correction'&&(v.activity!=='Solo'||v.status!=='Resolved'))fail('unsupported dispute discovery state');
 }
 if(kind==='pbe-chapter-work'&&((v.proofBytes??0)>v.bytes||v.bytes>16*1024*1024+(v.reason==='InputTooLarge'?65536:0)))fail('chapter total/proof byte accounting');
 if(kind==='pbe-chapter-manifest'){
  const entry=Object.hasOwn(manifestEntries,v.family)?manifestEntries[v.family]:null;if(!entry)fail('unsupported chapter manifest family');array(entry)(v.entries,'chapter manifest entries');
  if(v.id!==`${v.generationId}:${v.family}:${String(v.ordinal).padStart(6,'0')}`||v.id!==r.id)fail('chapter manifest identity correspondence mismatch');
  if(v.hash!==sha(v.entries)||v.bytes!==Buffer.byteLength(JSON.stringify(v)))fail('chapter manifest seal/hash/byte mismatch');
  if(v.bytes>65536||v.entries.length>128)fail('chapter manifest page cap');
 }
 if(kind==='pbe-chapter-stamp-proof'){
  if(!/^proof-\d{6}$/.test(v.family)||!v.id.startsWith(`${v.generationId}:${v.family}:`)||!/^\d{6}$/.test(v.id.slice(v.id.lastIndexOf(':')+1)))fail('unsupported chapter proof identity/family');
  if(v.hash!==sha(v.entries)||Buffer.byteLength(JSON.stringify(v))>65536)fail('chapter proof seal/hash/bytes mismatch');
  for(const e of v.entries)if(e.witness.some(c=>c.targetId!==e.targetId))fail('chapter proof target correspondence mismatch');
 }
 if(['pbe-chapter-manifest','pbe-chapter-stamp-proof','pbe-chapter-projection','pbe-chapter-stamp'].includes(kind)&&r.revision!==1)fail('immutable chapter revision mismatch');
}
/** Validate supported native and mapped-canonical PBE values, preserving exact input bytes.
 * Cross-record graph and missing legacy reference policy belong to the core importer.
 */
export function validateNativePbeRecords(records){
 if(!Array.isArray(records))fail('Records array required');
 for(const r of records){
  if(typeof r?.kind!=='string'||!r.kind.startsWith('pbe-'))continue;
  shape({...fields('kind id org_id data'),season_id:stringOrNull,owner_id:stringOrNull,revision:positive})(r,'Records');
  const schema=Object.hasOwn(schemas,r.kind)?schemas[r.kind]:null;if(!schema)fail(`unsupported operational kind ${r.kind}`);
  const value=parse(r.data,r.kind);schema(value,r.kind);correspondence(r.kind,value,r);
 }
}
