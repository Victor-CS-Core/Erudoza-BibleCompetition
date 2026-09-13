import {createHash} from 'node:crypto';
import {mapCanonicalChapters} from './cloudflare-pbe-chapter-mapping.mjs';

export const mappingId='canonical-pbe-a-d1-v1';
const fail=message=>{throw new Error(`PBE mapping blocked: ${message}`);};
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
 for(const [k,x] of Object.entries(v)){const f=required[k]??optional[k];if(!f)fail(`${p}: unsupported field ${k}`);f(x,`${p}.${k}`);}
};
const fields=(names,f=str)=>Object.fromEntries(names.split(' ').filter(Boolean).map(k=>[k,f]));
const timestamp=(v,p)=>{str(v,p);if(!Number.isFinite(Date.parse(v)))fail(`${p}: invalid timestamp`);};
const uuid=(v,p)=>{str(v,p);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)||v.toLowerCase()==='00000000-0000-0000-0000-000000000000')fail(`${p}: invalid UUID`);};
const strings=array(str),integers=array(integer),timeOrNull=nullable(timestamp),intOrNull=nullable(integer),stringOrNull=nullable(str);
class OriginalInt64 { constructor(raw){this.raw=raw;} }
export function parseCanonicalJson(text,label,rootIntegerStrings=new Set(),rootIntegerDictionaries=new Set()){
 str(text,label);
 try{
  const parsed=JSON.parse(text,(key,value,context)=>{
   if(typeof value==='number'&&(rootIntegerStrings.has(key)||rootIntegerDictionaries.size&&Number.isInteger(value)&&!Number.isSafeInteger(value))){
    if(!/^-?\d+$/.test(context.source)||BigInt(context.source)<-(1n<<63n)||BigInt(context.source)>(1n<<63n)-1n)fail(`${label}.${key}: invalid int64 scalar`);
    return new OriginalInt64(context.source);
   }
   if(typeof value==='number'&&(!Number.isFinite(value)||Number.isInteger(value)&&!Number.isSafeInteger(value)))fail(`${label}.${key}: unsafe JSON numeric scalar ${context.source}`);
   return value;
  });
  for(const key of rootIntegerStrings)if(parsed?.[key] instanceof OriginalInt64)parsed[key]=parsed[key].raw;
  for(const key of rootIntegerDictionaries){
   const original=parsed?.[key];
   dict((v,p)=>{if(!(v instanceof OriginalInt64))integer(v,p);})(original,`${label}.${key}`);
   parsed[key]=Object.fromEntries(Object.entries(original).map(([k,v])=>[k,v instanceof OriginalInt64?v.raw:String(v)]));
  }
  const check=v=>{if(v instanceof OriginalInt64)fail(`${label}: int64 scalar outside declared root field`);if(v&&typeof v==='object')for(const x of Object.values(v))check(x);};check(parsed);
  return parsed;
 }catch(error){if(error.message.startsWith('PBE mapping blocked:'))throw error;fail(`${label}: invalid JSON`);}
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
const attemptOptional={responseLockedAtUtc:timeOrNull,originalTimedAnswers:nullable(strings)};
const attempt=shape(attemptFields,attemptOptional);
const card=shape({id:str,question,targets:array(target),servedAtMs:intOrNull,assistedAtMs:intOrNull});
const versions={format:lit('Pbe'),ruleVersion:lit('nad-pbe-2023-24-v2'),scoringVersion:lit('pbe-rubric-v2'),selectionVersion:lit('pbe-selection-v1')};
const notebookEntry=shape({id:uuid,kind:lit('highlight','note','bookmark'),contentPackId:uuid,chapter:positive,sourceUnitId:nullable(uuid),startOffset:intOrNull,endOffset:intOrNull,color:lit(null,'Promises','People','Review'),note:stringOrNull,...fields('bookName citation quote'),updatedAtUtc:timestamp});
const notebook=shape({entries:(v,p)=>{
 array(notebookEntry)(v,p);if(v.length>200)fail(`${p}: notebook exceeds 200 entries`);
 const ids=new Set();
 for(const entry of v){
  if(ids.has(entry.id.toLowerCase()))fail(`${p}: duplicate notebook entry UUID`);ids.add(entry.id.toLowerCase());
  if(entry.kind==='bookmark'){
   if(entry.sourceUnitId!==null||entry.startOffset!==null||entry.endOffset!==null||entry.color!==null||entry.note!==null||entry.quote!=='')fail(`${p}: invalid bookmark entry`);
  }else{
   if(entry.sourceUnitId===null||entry.startOffset===null||entry.startOffset<0||entry.endOffset===null||entry.endOffset<=entry.startOffset||!entry.quote.trim())fail(`${p}: invalid anchored notebook entry`);
   if(entry.kind==='note'?(entry.color!==null||entry.note===null||entry.note!==entry.note.trim()||entry.note.length<1||entry.note.length>2000):(entry.note!==null||entry.color===null))fail(`${p}: invalid ${entry.kind} entry`);
  }
 }
}});
const session=shape({...fields('id studentUserId seasonId scopeVersion startPayload'),...versions,mode:lit('Practice','Review'),status:lit('Created','Active','Completed'),questionIds:strings,cards:array(card),attempts:array(attempt),createdAtUtc:timestamp,missionLocalDate:stringOrNull,creditedLocalDate:stringOrNull,newlyCreditedDay:bool},{completedAtUtc:timeOrNull,clientStartId:stringOrNull,timingStatus:lit(null),timingQuestionId:lit(null),timing:lit(null)});
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
 'pbe-attempt':shape({...attemptFields,sessionId:str,...versions},{responseLockedAtUtc:timeOrNull}),
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
const convertedAttempt=value=>{
 const {responseLockedAtUtc,originalTimedAnswers,...rest}=value;
 if(originalTimedAnswers!=null)fail('unsupported original timed answers');
 return {...rest,...(responseLockedAtUtc==null?{}:{responseLockedAtMs:milliseconds(responseLockedAtUtc,'response lock'),canonicalProvenance:{version:1,responseLockedAtUtc}})};
};
function convertValue(kind,value){
 if(kind==='pbe-attempt')return convertedAttempt(value);
 if(kind==='pbe-session'){
  const {timing,timingStatus,timingQuestionId,...rest}=value;
  return {...rest,attempts:value.attempts.map(convertedAttempt)};
 }
 return value;
}
function validateCorrespondence(kind,value){
 if(kind==='pbe-session'){
  if(JSON.stringify(value.questionIds)!==JSON.stringify(value.cards.map(c=>c.question.id)))fail('session question/card correspondence mismatch');
  const ids=new Set(),commands=new Set();
  for(const a of value.attempts){
   const card=value.cards.find(c=>c.id===a.cardId);
   if(!card||a.answers.length!==card.question.parts.length||a.id!==a.result.attemptId||a.result.expectedParts.length!==card.question.parts.length)fail('frozen answer/result correspondence mismatch');
   if(ids.has(a.id)||commands.has(a.clientSubmissionId))fail('duplicate original session attempt/command');ids.add(a.id);commands.add(a.clientSubmissionId);
  }
 }
 if(['pbe-dispute','pbe-dispute-pending','pbe-dispute-correction'].includes(kind)){
  const n=value.question.parts.length;
  if(value.questionId!==value.question.id||value.questionVersion!==value.question.version||value.answers.length!==n||value.partPoints.length!==n||value.originalPointsByPart.length!==n||value.resolution&&value.resolution.pointsByPart.length!==n)fail('dispute frozen part correspondence mismatch');
 }
}
const safeRevision=(v,p)=>{if(typeof v==='bigint'){if(v>BigInt(Number.MAX_SAFE_INTEGER)||v<1n)fail(`${p}: unsupported revision integer`);v=Number(v);}positive(v,p);return v;};
function milliseconds(v,p){
 timestamp(v,p);
 // Date.parse truncates fractional digits exactly as canonical ToUnixTimeMilliseconds.
 // Callers retain the original ISO string in explicitly versioned provenance.
 return Date.parse(v);
}
const sha=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');

export async function mapCanonicalPbe({snapshot,nativeCore}) {
 if(!snapshot?.tables||!Array.isArray(nativeCore?.records))fail('snapshot and nativeCore are required');
 const records=[],rooms=[],seen=new Set(),chapterRows=[];
 const add=r=>{const key=JSON.stringify([r.kind,r.id,r.org_id]);if(seen.has(key)||nativeCore.records.some(x=>x.kind===r.kind&&x.id===r.id&&x.org_id===r.org_id))fail(`duplicate native identity ${key}`);seen.add(key);records.push(r);};
 for(const row of snapshot.tables.PbeTrainingRecords??[]){
  shape({...fields('OrganizationId Kind Id DataJson'),SeasonId:stringOrNull,OwnerId:stringOrNull,Revision:()=>{}})(row,'PbeTrainingRecords');
  const revision=safeRevision(row.Revision,'PbeTrainingRecords.revision');
  const native={kind:row.Kind,id:row.Id,org_id:row.OrganizationId.toLowerCase(),season_id:row.SeasonId?.toLowerCase()??null,owner_id:row.OwnerId?.toLowerCase()??null,revision};
  if(row.Kind==='scripture-notebook'){
   if(row.SeasonId?.toLowerCase()!=='00000000-0000-0000-0000-000000000000'||row.OwnerId===null||row.Id.toLowerCase()!==row.OwnerId.toLowerCase())fail('invalid account-private notebook identity');
   uuid(row.OwnerId,'scripture-notebook owner');
   const value=parseCanonicalJson(row.DataJson,row.Kind);notebook(value,row.Kind);
   add({...native,season_id:null,data:row.DataJson});continue;
  }
  if(row.Kind.startsWith('pbe-chapter-')){chapterRows.push({...native,data:row.DataJson});continue;}
  const schema=schemas[row.Kind];if(!schema)fail(`unsupported operational kind ${row.Kind}`);
  const value=parseCanonicalJson(row.DataJson,row.Kind);schema(value,row.Kind);
  validateCorrespondence(row.Kind,value);
  if(['pbe-dispute-pending','pbe-dispute-correction'].includes(row.Kind)){
   if(native.owner_id!==value.participantIds[0])fail('canonical dispute discovery owner differs');
   if(row.Kind==='pbe-dispute-correction'&&(value.activity!=='Solo'||value.status!=='Resolved'))fail('unsupported correction discovery state');
   if(row.Kind==='pbe-dispute-pending'&&value.status!=='Pending')fail('unsupported pending discovery state');
   native.owner_id=value.activity;
  }
  const converted=convertValue(row.Kind,value);
  add({...native,data:converted===value?row.DataJson:JSON.stringify(converted)});
 }
 if(chapterRows.length)for(const r of mapCanonicalChapters({rows:chapterRows,nativeCore,operationalRecords:records,snapshot,codec:{shape,fields,str,integer,positive,bool,nullable,array,lit,parseCanonicalJson,projection,question,target,candidate,timestamp}}))add(r);
 for(const row of snapshot.tables.PracticeRoomRecord??[]){const mapped=mapRoom(row);if(rooms.some(r=>r.scope.orgId===mapped.scope.orgId&&r.scope.id===mapped.scope.id))fail('duplicate room identity');rooms.push(mapped);}
 for(const row of snapshot.tables.PracticeAwardRecord??[])add(mapAward(row));
 return {records,rooms,consumedTables:['PbeTrainingRecords','PracticeRoomRecord','PracticeAwardRecord'].filter(t=>Object.hasOwn(snapshot.tables,t)),mappingId};
}
const mapRoom=convertRoom;
const mapAward=convertAward;

const coachReading=shape({...fields('questionId coachId'),completedAtMs:integer});
const practiceQuestion=shape({...fields('id contentPackId sourceUnitId prompt kind evidence reference'),version:positive,ordered:bool,parts:array(shape({acceptedAnswers:strings,points:integer})),rubric:question});
const roomSubmission=shape({...fields('attemptId questionId scribeId'),responseLockedAtUtc:timeOrNull,team:integer,answers:strings,elapsedTicks:integer,deadlineDraft:bool,...fields('accuracyHundredths speedHundredths',integer),...fields('appealed resolved',bool),appealReason:stringOrNull});
const award=shape(fields('key title seasonId userId'));
const roomSchema=shape({
 format:lit('Pbe'),teamCount:lit(1,2),selectionVersion:lit('pbe-team-question-max-v1'),selectionSeed:str,
 coachReading:nullable(coachReading),coachReadyScribeIds:strings,presentationDelivery:dict(lit('Audio','TextFallback','Coach')),draftReceivedAt:dict(str),sourceProofs:dict(str),interruptionReason:nullable(lit('ArmedResponsesUntrusted','UnarmedReserveUnavailable')),
 replacements:array(shape({original:practiceQuestion,replacementId:str,atUtc:timestamp,reason:str})),
 presentations:dict(shape({scheduleId:str,responseStartsAtUtc:timestamp,responseEndsAtUtc:timestamp,delivery:dict(str),coachReading:nullable(coachReading)})),services:array(roomService),
 ...fields('id seasonId ownerId'),coachId:stringOrNull,...fields('teamSize questionCount',integer),bookKey:stringOrNull,coached:bool,
 status:lit('Completed','Interrupted'),phase:lit('Complete','Review','Interrupted'),ruleVersion:lit('pbe-rehearsal-v1'),scoringVersion:lit('pbe-accuracy-v1'),revision:positive,questionIndex:integer,
 processId:str,phaseTimestamp:str,responseTimestamp:str,phaseEndsAt:lit(null),responseStartsAt:timeOrNull,scheduleId:str,acknowledged:strings,
 members:array(shape({...fields('userId displayName'),team:integer,...fields('ready captain scribe',bool)})),
 invitations:array(shape({...fields('id roomId userId inviterName'),team:intOrNull,expiresAt:timestamp,accepted:bool})),
 questions:array(practiceQuestion),reserves:array(practiceQuestion),submissions:array(roomSubmission),
 messages:array(shape({...fields('id userId displayName text'),team:integer,createdAt:timestamp})),drafts:dict(strings),appliedCommands:dict(str),
 contributions:array(shape({...fields('userId questionId'),scribe:bool})),completedAt:timeOrNull,awards:array(award),
 adjustments:array(shape({...fields('questionId coachId reason'),...fields('team oldPoints newPoints',integer),at:timestamp})),
 timingDiagnostics:dict(shape({...fields('rttMs jitterMs',num),samples:integer})),
});
function unwrapQuestion(q){
 const r=q.rubric;
 for(const key of ['id','version','contentPackId','sourceUnitId','prompt','kind','ordered','evidence','reference'])if(q[key]!==r[key])fail(`room question/rubric mismatch ${key}`);
 if(JSON.stringify(q.parts)!==JSON.stringify(r.parts.map(({acceptedAnswers,points})=>({acceptedAnswers,points}))))fail('room question/rubric parts mismatch');
 return r;
}
function convertRoom(row){
 shape({...fields('Id OrganizationId SeasonId Status StateJson'),Revision:()=>{},UpdatedAt:timestamp})(row,'PracticeRoomRecord');
 const r=parseCanonicalJson(row.StateJson,'PracticeRoomRecord.StateJson',new Set(['phaseTimestamp','responseTimestamp']),new Set(['draftReceivedAt']));roomSchema(r,'room');
 if(r.id!==row.Id.toLowerCase()||r.seasonId!==row.SeasonId.toLowerCase()||r.status!==row.Status||r.revision!==safeRevision(row.Revision,'Room revision'))fail('room column/authority identity mismatch');
 // Canonical Next marks completion without replacing Review; native terminal status stops advancement.
 if(r.status==='Interrupted'?r.phase!=='Interrupted':!['Complete','Review'].includes(r.phase))fail('unsupported terminal status/phase pairing');
 if(r.status==='Completed'&&r.completedAt===null)fail('completed room lacks original completion timestamp');
 const ms=v=>v===null?null:milliseconds(v,'room timestamp');
 const {ruleVersion,scoringVersion,processId,phaseTimestamp,responseTimestamp,draftReceivedAt,appliedCommands,awards,timingDiagnostics,...common}=r;
 const room={...common,orgId:row.OrganizationId.toLowerCase(),epoch:processId,lastObserved:ms(row.UpdatedAt),phaseEndsAt:null,responseStartsAt:ms(r.responseStartsAt),applied:appliedCommands,
 questions:r.questions.map(unwrapQuestion),reserves:r.reserves.map(unwrapQuestion),
 replacements:r.replacements.map(({original,replacementId,atUtc,reason})=>({original:unwrapQuestion(original),replacementId,atMs:ms(atUtc),reason})),
 presentations:Object.fromEntries(Object.entries(r.presentations).map(([k,v])=>[k,{scheduleId:v.scheduleId,responseStartsAt:ms(v.responseStartsAtUtc),responseEndsAt:ms(v.responseEndsAtUtc),delivery:v.delivery,...(v.coachReading?{coachReading:v.coachReading}:{})}])),
 submissions:r.submissions.map(({elapsedTicks,responseLockedAtUtc,...s})=>{
  const elapsedMs=elapsedTicks/10000;if(Math.round(elapsedMs*10000)!==elapsedTicks)fail('elapsed tick conversion loses precision');
  return {...s,elapsedMs,...(responseLockedAtUtc===null?{}:{responseLockedAtMs:ms(responseLockedAtUtc)})};
 }),
 rules:{ruleVersion,scoringVersion,clock:'server-event-time',presentationSeconds:15,reviewSeconds:10,speedPercent:0,stepSeconds:1},timingAnomalies:[],
 canonicalProvenance:{version:1,provider:'dotnet-practice-v1',processId,phaseTimestamp,responseTimestamp,draftReceivedAt,awards,timingDiagnostics,updatedAt:row.UpdatedAt,responseStartsAt:r.responseStartsAt,phaseEndsAt:r.phaseEndsAt,presentationTimes:Object.fromEntries(Object.entries(r.presentations).map(([k,p])=>[k,{responseStartsAtUtc:p.responseStartsAtUtc,responseEndsAtUtc:p.responseEndsAtUtc}])),replacementTimes:r.replacements.map(p=>({replacementId:p.replacementId,atUtc:p.atUtc})),submissionTimes:r.submissions.map(s=>({attemptId:s.attemptId,questionId:s.questionId,team:s.team,elapsedTicks:String(s.elapsedTicks),responseLockedAtUtc:s.responseLockedAtUtc})),stateSha256:sha(row.StateJson)},
 };
 return {scope:{kind:'room',orgId:row.OrganizationId.toLowerCase(),seasonId:row.SeasonId.toLowerCase(),id:row.Id.toLowerCase()},room};
}
function convertAward(row){
 shape({...fields('OrganizationId SeasonId UserId Key Title'),ReconciledAt:timestamp})(row,'PracticeAwardRecord');
 if(!/^pbe-team-v1:(first-fellowship|team-steady|shared-scribe|team-precision|rehearsal-complete)$/.test(row.Key))fail('unsupported legacy PracticeAwardRecord');
 const data={key:row.Key,title:row.Title,seasonId:row.SeasonId.toLowerCase(),userId:row.UserId.toLowerCase()};
 // This canonical entity has no revision column: native's initial schema revision is 1.
 return {kind:'award',id:`${row.Key}:${data.userId}:${data.seasonId}`,org_id:row.OrganizationId.toLowerCase(),season_id:data.seasonId,owner_id:data.userId,data:JSON.stringify(data),revision:1};
}
