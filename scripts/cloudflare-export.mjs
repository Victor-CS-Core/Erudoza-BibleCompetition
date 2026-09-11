import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { libraryRecords, LIBRARY_ORGANIZATION, stableId } from '../apps/web/scripts/nkjv-library.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const libraryOrg='00000000-0000-4000-8000-000000000066';
const core = ['Organizations','Users','OrganizationMembers','ContentPacks','SourceDocuments','SourceUnits','KnowledgeUnits','RuleProfiles','Seasons','ScopeEntries','Assignments','AssignmentScopes','CompetitionMembers','StudySessions','ChallengeCards','Attempts','MasteryStates','ReviewSchedules'];
const trainingTables=['TrainingPreferences','TrainingDays','TrainingWeeks','DailyMissions','TrainingSeasonProgress','SoloBadgeAwards'];
const archive = ['AuditEvents','GenerationJobs','PromptVersions','QuestionCandidates','PlayableQuestions','StudentProfiles','Teams','QuestionEvidence','__EFMigrationsHistory','__EFMigrationsLock','PracticeRoomRecord','PracticeQuestionRecord','PracticeSetting','PracticeAwardRecord'];
const enums = {kind:['Adult','Student'],role:['Owner','Admin','Student'],season:['Draft','ContentReady','AssignmentsReady','Active','Completed','Archived'],assignment:['PrimarySpecialist','RequiredCoverage','OptionalReview'],source:['Scripture','Supplemental'],mode:['Practice','Review','Simulation'],session:['Created','Active','Completed','Abandoned'],answer:['ExactText','ShortFact','OrderedSequence','SelectedChoice'],level:['Unseen','Learning','Review','Strong','Mastered']};
const requiredColumns={Organizations:'Id Name Slug',Users:'Id UserName Email PasswordHash DisplayName Kind IsActive SecurityStamp',OrganizationMembers:'Id OrganizationId UserId Role',ContentPacks:'Id OrganizationId PackKey Version Locale SourceType LicensingStatus IsActive CreatedAtUtc',SourceUnits:'Id OrganizationId ContentPackId SourceDocumentId CanonicalText CitationLabel BookKey Chapter Verse Ordinal IsActive IsRetired ContentHash NormalizedComparisonText LicensingMetadata Locale',KnowledgeUnits:'Id OrganizationId SourceUnitId Kind',RuleProfiles:'Id Key Version ConfigurationJson',Seasons:'Id OrganizationId Name YearLabel Status RuleProfileId StartDate TargetCompetitionDate CreatedAtUtc ActivatedAtUtc',ScopeEntries:'Id OrganizationId SeasonId ContentPackId Kind BookKey StartChapter StartVerse EndChapter EndVerse',Assignments:'Id OrganizationId SeasonId StudentUserId Type CreatedAtUtc',AssignmentScopes:'Id AssignmentId ContentPackId BookKey StartChapter StartVerse EndChapter EndVerse',CompetitionMembers:'Id OrganizationId SeasonId UserId Difficulty TeamId',StudySessions:'Id OrganizationId SeasonId StudentUserId Mode Status Difficulty DifficultyPolicyVersion TargetCardCount RuleProfileSnapshotJson CreatedAtUtc CompletedAtUtc',ChallengeCards:'Id OrganizationId SessionId StudentUserId SeasonId KnowledgeUnitId SourceUnitId AnswerSourceUnitId ActivityType ProviderType AnswerMode EvaluatorVersion PayloadJson AnswerKeyJson Sequence CreatedAtUtc',Attempts:'Id OrganizationId SessionId ChallengeCardId StudentUserId SeasonId KnowledgeUnitId ClientSubmissionId SubmittedAnswer NormalizedAnswer IsCorrect EvaluationResult EvaluatorVersion ResponseTimeMs HintsUsed ActivityType CreatedAtUtc IsLegacyDuplicate ResultJson',MasteryStates:'Id OrganizationId StudentUserId SeasonId KnowledgeUnitId RecognitionScore ExactWordingScore ReferenceScore SequenceScore FactualRecallScore Level AlgorithmVersion UpdatedAtUtc',ReviewSchedules:'Id OrganizationId StudentUserId SeasonId KnowledgeUnitId DueAtUtc AlgorithmVersion'};
const fail = message => { throw new Error(`Migration blocked: ${message}`); };
const enumValue = (name,value) => enums[name][value-1] ?? fail(`unsupported ${name} enum ${value}`);
const difficulty = value => ({1:'Foundation',3:'Standard',5:'Advanced'}[value] ?? fail(`unsupported difficulty ${value}`));
const guid = value => typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value) ? value.toLowerCase() : fail('invalid required GUID');
const camel = value => Array.isArray(value) ? value.map(camel) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k,v])=>[k[0].toLowerCase()+k.slice(1),camel(v)])) : value;
const parsed = (value,label) => { try { return camel(JSON.parse(value)); } catch { return fail(`invalid JSON in ${label}`); } };
const iso = value => value == null ? null : Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : fail('invalid timestamp');
const range = row => ({bookKey:row.BookKey,startChapter:row.StartChapter,startVerse:row.StartVerse,endChapter:row.EndChapter,endVerse:row.EndVerse});
const hash = value => createHash('sha256').update(value).digest('hex');
const quote = value => value == null ? 'NULL' : typeof value === 'number' ? String(value) : `'${String(value).replaceAll("'","''")}'`;

export function readSource(sourcePath) {
  const db = new DatabaseSync(resolve(sourcePath), {readOnly:true});
  try {
    db.exec('BEGIN');
    if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') fail('source integrity check failed');
    if (db.prepare('PRAGMA foreign_key_check').all().length) fail('source foreign key check failed');
    const definitions = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    const tables = Object.fromEntries(definitions.map(t=>[t.name,db.prepare(`SELECT * FROM "${t.name.replaceAll('"','""')}"`).all()]));
    db.exec('COMMIT');
    return {tables,definitions};
  } finally { db.close(); }
}

export function convertSnapshot(snapshot) {
  const {tables} = snapshot;
  for (const name of core) if (!tables[name]) fail(`required table ${name} is absent`);
  for(const [table,columns]of Object.entries(requiredColumns))for(const row of tables[table])for(const column of columns.split(' '))if(!Object.hasOwn(row,column))fail(`required column ${table}.${column} is absent`);
  for (const [name,rows] of Object.entries(tables)) if (!core.includes(name) && !archive.includes(name) && !trainingTables.includes(name) && rows.length) fail(`unsupported nonempty table ${name}`);
  const rows = name => tables[name] ?? [];
  const index = name => new Map(rows(name).map(r=>[guid(r.Id),r]));
  const orgs=index('Organizations'), users=index('Users'), seasons=index('Seasons'), packs=index('ContentPacks'), sources=index('SourceUnits'), knowledge=index('KnowledgeUnits'), profiles=index('RuleProfiles'), sessions=index('StudySessions'), cards=index('ChallengeCards');
  const requireRef=(map,value,label)=>map.get(guid(value))??fail(`missing ${label} reference`);
  if (!orgs.size) fail('no organizations');
  const native={organizations:[],users:[],records:[]};
  const add=(kind,key,org,value,season=null,owner=null)=>{requireRef(orgs,org,'organization');native.records.push({kind,id:String(key),org_id:guid(org),season_id:season?guid(season):null,owner_id:owner?String(owner).toLowerCase():null,data:value});return value;};
  const sameOrg=(a,b,label)=>{if(guid(a)!==guid(b))fail(`cross-organization ${label}`);};
  const isLibraryPack=p=>!!p.IsBuiltIn&&guid(p.OrganizationId)===libraryOrg;
  const contentOrg=(p,org,label)=>{if(!isLibraryPack(p))sameOrg(p.OrganizationId,org,label);};
  const sourceOrg=(s,org,label)=>contentOrg(requireRef(packs,s.ContentPackId,label),org,label);
  const group=(values,key)=>{const grouped=new Map();for(const value of values){const k=guid(value[key]);if(!grouped.has(k))grouped.set(k,[]);grouped.get(k).push(value);}return grouped;};
  const packSources=group(rows('SourceUnits'),'ContentPackId'),sourceKnowledge=group(rows('KnowledgeUnits'),'SourceUnitId');
  const userOrg=new Map();
  for(const r of rows('Organizations')) native.organizations.push({id:guid(r.Id),name:r.Name,slug:r.Slug});
  for(const r of rows('Users')) {
    const members=rows('OrganizationMembers').filter(m=>guid(m.UserId)===guid(r.Id));
    if(members.length!==1)fail('each user must have exactly one organization membership');
    const m=members[0]; requireRef(orgs,m.OrganizationId,'membership organization');
    const kind=enumValue('kind',r.Kind),role=enumValue('role',m.Role);
    if((kind==='Student')!==(role==='Student'))fail('user kind and role mismatch');
    if(typeof r.PasswordHash!=='string'||!/^pbkdf2:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$/.test(r.PasswordHash))fail('unsupported password hash format');
    userOrg.set(guid(r.Id),guid(m.OrganizationId));
    native.users.push({id:guid(r.Id),org_id:guid(m.OrganizationId),user_name:r.UserName,email:r.Email,display_name:r.DisplayName,kind,role,password_hash:r.PasswordHash,credential_version:r.SecurityStamp||`migration-${randomUUID()}`,active:r.IsActive});
  }
  const checkStudent=(user,org)=>{const u=requireRef(users,user,'student');if(u.Kind!==2||userOrg.get(guid(user))!==guid(org))fail('student is outside organization');};
  const rule = r => {
    if(r.Key!=='PBE_STYLE_V1'||r.Version!==1)fail('only PBE_STYLE_V1 version 1 rule profiles are supported');
    const config=parsed(r.ConfigurationJson,'rule profile');
    const result={studyAllowMultipleChoice:config.study?.allowMultipleChoice,simulationAllowMultipleChoice:config.simulation?.allowMultipleChoice,simulationAllowTrueFalse:config.simulation?.allowTrueFalse,showReference:config.simulation?.showReference,trueFalseMaxRatio:config.simulation?.trueFalseMaxRatio};
    if(JSON.stringify(result)!==JSON.stringify({studyAllowMultipleChoice:true,simulationAllowMultipleChoice:false,simulationAllowTrueFalse:true,showReference:true,trueFalseMaxRatio:0.1}))fail('PBE_STYLE_V1 configuration differs from native built-in');
    return result;
  };
  for(const p of rows('RuleProfiles'))rule(p);
  const libraryPacks=rows('ContentPacks').filter(isLibraryPack);
  const libraryBytes=libraryPacks.length?readFileSync(resolve(root,'content/nkjv/library-manifest.json')):null;
  const libraryManifest=libraryBytes?JSON.parse(libraryBytes):null;
  const libraryFiles=libraryManifest?.books.map(b=>JSON.parse(readFileSync(resolve(root,'content/nkjv',b.file))))??[];
  const canonicalLibrary=libraryManifest?new Map(libraryRecords({manifest:libraryManifest,packs:libraryFiles,manifestSha256:hash(libraryBytes)}).map(r=>[`${r.kind}:${r.id}`,r.data])):new Map();
  for(const r of rows('ContentPacks')) {
    const units=packSources.get(guid(r.Id))??[];let metadata={};
    if(r.IsBuiltIn&&!isLibraryPack(r))fail('built-in content outside the reserved library');
    if(isLibraryPack(r)){
      const ordinal=libraryManifest.books.findIndex(b=>b.contentPackId===guid(r.Id)),book=libraryManifest.books[ordinal];
      if(!book||r.Version!==libraryManifest.version||!r.IsActive)fail('unknown or unavailable built-in library version');
      const bytes=readFileSync(resolve(root,'content/nkjv',book.file));if(hash(bytes)!==book.sha256)fail('library artifact hash mismatch');
      const expected=JSON.parse(bytes).documents.flatMap(d=>d.units),actual=new Map(units.map(s=>[`${s.BookKey}:${s.Chapter}:${s.Verse}`,s]));
      if(units.length!==expected.length||expected.some(u=>{const s=actual.get(`${u.bookKey}:${u.chapter}:${u.verse}`);return !s||guid(s.Id)!==stableId(`verse:${u.bookKey}:${u.chapter}:${u.verse}`)||s.CanonicalText!==u.text||s.CitationLabel!==u.citation||s.Ordinal!==u.ordinal||!s.IsActive||s.IsRetired;}))fail('built-in source content differs from the versioned library');
      metadata={isBuiltIn:true,bookKey:book.bookKey,bookName:book.name,bookOrdinal:ordinal+1,chapters:book.chapters,sourcePdfSha256:libraryManifest.sourcePdfSha256};
    }
    add('pack',guid(r.Id),r.OrganizationId,canonicalLibrary.get(`pack:${guid(r.Id)}`)??{id:guid(r.Id),packKey:r.PackKey,version:r.Version,locale:r.Locale,sourceType:enumValue('source',r.SourceType),licensingStatus:r.LicensingStatus,isActive:!!r.IsActive,unitCount:units.length,createdAtUtc:iso(r.CreatedAtUtc),...metadata});
  }
  if(libraryPacks.length){if(libraryPacks.length!==66)fail('incomplete built-in library');Object.assign(native.organizations.find(o=>o.id===libraryOrg),LIBRARY_ORGANIZATION);}
  const convertedSources=new Map();
  for(const r of rows('SourceUnits')) {
    sameOrg(requireRef(packs,r.ContentPackId,'source pack').OrganizationId,r.OrganizationId,'source pack');
    const units=sourceKnowledge.get(guid(r.Id))??[];
    if(units.length!==1||units[0].Kind!==1)fail('source must have exactly one ExactVerseText knowledge unit');
    if(isLibraryPack(requireRef(packs,r.ContentPackId,'source pack'))&&guid(units[0].Id)!==guid(r.Id))fail('built-in knowledge identity differs from source identity');
    sameOrg(units[0].OrganizationId,r.OrganizationId,'knowledge unit');
    const s=add('source',guid(r.Id),r.OrganizationId,canonicalLibrary.get(`source:${guid(r.Id)}`)??{id:guid(r.Id),contentPackId:guid(r.ContentPackId),knowledgeUnitId:guid(units[0].Id),citation:r.CitationLabel,bookKey:r.BookKey,chapter:r.Chapter,verse:r.Verse,ordinal:r.Ordinal,canonicalText:r.CanonicalText,isActive:!!r.IsActive,isRetired:!!r.IsRetired,contentHash:r.ContentHash,normalizedComparisonText:r.NormalizedComparisonText,licensingMetadata:r.LicensingMetadata,locale:r.Locale,sourceDocumentId:guid(r.SourceDocumentId)},null,guid(r.ContentPackId));
    convertedSources.set(s.id,s);
  }
  for(const r of rows('Seasons')) {
    const profile=requireRef(profiles,r.RuleProfileId,'rule profile');
    add('season',guid(r.Id),r.OrganizationId,{id:guid(r.Id),organizationId:guid(r.OrganizationId),name:r.Name,yearLabel:r.YearLabel,status:enumValue('season',r.Status),ruleProfileKey:profile.Key,ruleProfileVersion:profile.Version,startDate:r.StartDate,targetCompetitionDate:r.TargetCompetitionDate,createdAtUtc:iso(r.CreatedAtUtc),activatedAtUtc:iso(r.ActivatedAtUtc)});
    const scopes=rows('ScopeEntries').filter(s=>guid(s.SeasonId)===guid(r.Id));
    for(const s of scopes){sameOrg(s.OrganizationId,r.OrganizationId,'scope');contentOrg(requireRef(packs,s.ContentPackId,'scope pack'),r.OrganizationId,'scope pack');if(![1,2].includes(s.Kind))fail('unsupported scope kind');}
    const entries=[...group(scopes,'ContentPackId')].map(([contentPackId,list])=>({contentPackId,includes:list.filter(s=>s.Kind===1).map(range),excludes:list.filter(s=>s.Kind===2).map(range)}));
    add('scope',guid(r.Id),r.OrganizationId,{...(entries.length===1?entries[0]:{contentPackId:null,includes:[],excludes:[]}),packs:entries},r.Id);
  }
  for(const r of rows('Assignments')) {
    sameOrg(requireRef(seasons,r.SeasonId,'assignment season').OrganizationId,r.OrganizationId,'assignment');checkStudent(r.StudentUserId,r.OrganizationId);
    const scopes=rows('AssignmentScopes').filter(s=>guid(s.AssignmentId)===guid(r.Id));if(scopes.length!==1)fail('each assignment must have exactly one scope');
    const s=scopes[0];contentOrg(requireRef(packs,s.ContentPackId,'assignment pack'),r.OrganizationId,'assignment pack');
    add('assignment',guid(r.Id),r.OrganizationId,{id:guid(r.Id),seasonId:guid(r.SeasonId),studentUserId:guid(r.StudentUserId),contentPackId:guid(s.ContentPackId),type:enumValue('assignment',r.Type),createdAtUtc:iso(r.CreatedAtUtc),...range(s)},r.SeasonId,r.StudentUserId);
  }
  for(const r of rows('CompetitionMembers')) {
    sameOrg(requireRef(seasons,r.SeasonId,'membership season').OrganizationId,r.OrganizationId,'membership');checkStudent(r.UserId,r.OrganizationId);
    add('membership',`${guid(r.SeasonId)}:${guid(r.UserId)}`,r.OrganizationId,{id:guid(r.Id),seasonId:guid(r.SeasonId),studentUserId:guid(r.UserId),userId:guid(r.UserId),difficulty:difficulty(r.Difficulty),teamId:r.TeamId?guid(r.TeamId):null},r.SeasonId,r.UserId);
  }
  const convertedMastery=new Map();
  for(const r of rows('MasteryStates')) {
    checkStudent(r.StudentUserId,r.OrganizationId);sameOrg(requireRef(seasons,r.SeasonId,'mastery season').OrganizationId,r.OrganizationId,'mastery');
    const k=requireRef(knowledge,r.KnowledgeUnitId,'mastery knowledge');sourceOrg(requireRef(sources,k.SourceUnitId,'mastery source'),r.OrganizationId,'mastery knowledge');
    const reviews=rows('ReviewSchedules').filter(v=>guid(v.SeasonId)===guid(r.SeasonId)&&guid(v.StudentUserId)===guid(r.StudentUserId)&&guid(v.KnowledgeUnitId)===guid(r.KnowledgeUnitId));
    if(reviews.length>1)fail('duplicate review schedule');
    const m=add('mastery',guid(r.Id),r.OrganizationId,{id:guid(r.Id),studentUserId:guid(r.StudentUserId),seasonId:guid(r.SeasonId),sourceUnitId:guid(k.SourceUnitId),knowledgeUnitId:guid(r.KnowledgeUnitId),recognition:r.RecognitionScore,exactWording:r.ExactWordingScore,reference:r.ReferenceScore,sequence:r.SequenceScore,factualRecall:r.FactualRecallScore,level:enumValue('level',r.Level),algorithmVersion:r.AlgorithmVersion,reviewDueAt:reviews.length?iso(reviews[0].DueAtUtc):null,lastSeenAt:iso(r.UpdatedAtUtc),...(r.LastAttemptId?{lastAttemptId:guid(r.LastAttemptId)}:{})},r.SeasonId,r.StudentUserId);
    const key=`${m.seasonId}:${m.studentUserId}:${m.knowledgeUnitId}`;if(convertedMastery.has(key))fail('duplicate mastery state');convertedMastery.set(key,m);
  }
  for(const r of rows('ReviewSchedules'))if(!convertedMastery.has(`${guid(r.SeasonId)}:${guid(r.StudentUserId)}:${guid(r.KnowledgeUnitId)}`))fail('review schedule without mastery requires explicit conversion');
  const convertedCards=new Map();
  for(const r of rows('ChallengeCards')) {
    const session=requireRef(sessions,r.SessionId,'card session');sameOrg(session.OrganizationId,r.OrganizationId,'card');
    if(guid(session.StudentUserId)!==guid(r.StudentUserId)||guid(session.SeasonId)!==guid(r.SeasonId))fail('card boundaries differ from session');
    if(!['MissingWords','VerseBuilder','ReferenceMatch','WhatComesNext','TrueFalse'].includes(r.ActivityType))fail('unsupported solo activity');
    const source=convertedSources.get(guid(r.SourceUnitId))??fail('missing card source'),answerSource=convertedSources.get(guid(r.AnswerSourceUnitId??r.SourceUnitId))??fail('missing answer source');
    sourceOrg(requireRef(sources,r.SourceUnitId,'source'),r.OrganizationId,'card source');sourceOrg(requireRef(sources,answerSource.id,'answer source'),r.OrganizationId,'answer source');
    const payload=parsed(r.PayloadJson,'card payload'),answerKey=parsed(r.AnswerKeyJson,'answer key');
    if(typeof answerKey.canonicalAnswer!=='string'||!Array.isArray(payload.tokens)||typeof payload.prompt!=='string'||!Number.isInteger(payload.difficulty))fail('unsupported immutable card payload');
    const card={id:guid(r.Id),activityType:r.ActivityType,providerType:r.ProviderType,answerMode:enumValue('answer',r.AnswerMode),evaluatorVersion:r.EvaluatorVersion,payload,answerKey,sourceUnitId:source.id,knowledgeUnitId:guid(r.KnowledgeUnitId),...(r.AnswerSourceUnitId?{answerSourceUnitId:answerSource.id}:{}),sequence:r.Sequence,createdAtUtc:iso(r.CreatedAtUtc),source,answerSource};
    convertedCards.set(card.id,card);
  }
  const convertedAttempts=[];
  for(const r of rows('Attempts')) {
    const card=convertedCards.get(guid(r.ChallengeCardId))??fail('missing attempt card'),session=requireRef(sessions,r.SessionId,'attempt session');
    sameOrg(session.OrganizationId,r.OrganizationId,'attempt');if(guid(requireRef(cards,r.ChallengeCardId,'card').SessionId)!==guid(r.SessionId)||guid(session.StudentUserId)!==guid(r.StudentUserId)||guid(session.SeasonId)!==guid(r.SeasonId)||card.knowledgeUnitId!==guid(r.KnowledgeUnitId))fail('attempt boundaries differ from card/session');
    const m=convertedMastery.get(`${guid(r.SeasonId)}:${guid(r.StudentUserId)}:${guid(r.KnowledgeUnitId)}`);
    const result=r.ResultJson?parsed(r.ResultJson,'attempt result'):{attemptId:guid(r.Id),isCorrect:!!r.IsCorrect,evaluationResult:r.EvaluationResult,canonicalAnswer:card.answerKey.canonicalAnswer,citation:card.answerSource.citation,sourceText:card.answerSource.canonicalText,masteryLevel:m?.level??'Learning',exactWordingScore:m?.exactWording??0,reviewDueAtUtc:m?.reviewDueAt??null,alreadyProcessed:false};
    if(guid(result.attemptId)!==guid(r.Id)||typeof result.canonicalAnswer!=='string'||result.isCorrect!==!!r.IsCorrect)fail('invalid original attempt feedback');
    convertedAttempts.push(add('attempt',guid(r.Id),r.OrganizationId,{id:guid(r.Id),sessionId:guid(r.SessionId),cardId:card.id,studentUserId:guid(r.StudentUserId),seasonId:guid(r.SeasonId),sourceUnitId:card.answerSource.id,knowledgeUnitId:guid(r.KnowledgeUnitId),clientSubmissionId:r.ClientSubmissionId,submittedAnswer:r.SubmittedAnswer,normalizedAnswer:r.NormalizedAnswer,responseTimeMs:r.ResponseTimeMs,hintsUsed:!!r.HintsUsed,isCorrect:!!r.IsCorrect,evaluationResult:r.EvaluationResult,evaluatorVersion:r.EvaluatorVersion,activityType:r.ActivityType,at:iso(r.CreatedAtUtc),result,isLegacyDuplicate:!!r.IsLegacyDuplicate,feedbackReconstructed:!r.ResultJson,...(r.BeforeSkillsJson?{before:parsed(r.BeforeSkillsJson,'before skills')}:{}),...(r.AfterSkillsJson?{after:parsed(r.AfterSkillsJson,'after skills')}:{}),...(r.PreviousAttemptId?{previousAttemptId:guid(r.PreviousAttemptId)}:{})},r.SeasonId,r.StudentUserId));
  }
  const sessionTraining=r=>{const t=parsed(r.TrainingJson,'session training');if(t.startPayload){const p=parsed(t.startPayload,'start payload');const input=p.training; t.startPayload=JSON.stringify({seasonId:guid(p.seasonId),mode:typeof p.mode==='number'?enumValue('mode',p.mode):p.mode,training:Object.fromEntries(['clientStartId','timeZone','missionId','missionRevision','step'].filter(k=>input[k]!=null).map(k=>[k,input[k]]))});}return t;};
  for(const r of rows('StudySessions')) {
    checkStudent(r.StudentUserId,r.OrganizationId);sameOrg(requireRef(seasons,r.SeasonId,'session season').OrganizationId,r.OrganizationId,'session');
    const sessionCards=rows('ChallengeCards').filter(c=>guid(c.SessionId)===guid(r.Id)).map(c=>convertedCards.get(guid(c.Id))).sort((a,b)=>a.sequence-b.sequence);
    const attempts=convertedAttempts.filter(a=>a.sessionId===guid(r.Id)&&!a.isLegacyDuplicate);
    if(new Set(attempts.map(a=>a.cardId)).size!==attempts.length||new Set(attempts.map(a=>a.clientSubmissionId)).size!==attempts.length)fail('duplicate nonlegacy card/submission evidence');
    if(new Set(sessionCards.map(c=>c.sequence)).size!==sessionCards.length)fail('duplicate card sequence');
    const snapshotRules=r.RuleProfileSnapshotJson?parsed(r.RuleProfileSnapshotJson,'session rule snapshot'):rule(requireRef(profiles,requireRef(seasons,r.SeasonId,'season').RuleProfileId,'profile'));
    if(snapshotRules.key&&snapshotRules.key!=='PBE_STYLE_V1'||snapshotRules.version&&snapshotRules.version!==1)fail('unsupported session rule snapshot');
    const profile={studyAllowMultipleChoice:snapshotRules.studyAllowMultipleChoice,simulationAllowMultipleChoice:snapshotRules.simulationAllowMultipleChoice,simulationAllowTrueFalse:snapshotRules.simulationAllowTrueFalse,showReference:snapshotRules.showReference,trueFalseMaxRatio:snapshotRules.trueFalseMaxRatio};
    if(Object.entries(profile).some(([key,value])=>key==='trueFalseMaxRatio'?typeof value!=='number':typeof value!=='boolean'))fail('incomplete session rules');
    add('session',guid(r.Id),r.OrganizationId,{id:guid(r.Id),studentUserId:guid(r.StudentUserId),seasonId:guid(r.SeasonId),status:enumValue('session',r.Status),mode:enumValue('mode',r.Mode),difficulty:difficulty(r.Difficulty),difficultyPolicyVersion:r.DifficultyPolicyVersion,targetCardCount:r.TargetCardCount,ruleProfile:profile,cards:sessionCards,attempts,createdAtUtc:iso(r.CreatedAtUtc),completedAtUtc:iso(r.CompletedAtUtc),...(r.TrainingJson?{training:sessionTraining(r)}:{}),...(r.RecapJson?{recap:parsed(r.RecapJson,'session recap')}:{})},r.SeasonId,r.StudentUserId);
  }
  const trainingId=(r,...parts)=>[guid(r.OrganizationId),guid(r.StudentUserId),...parts].join(':');
  const trainingAdd=(kind,id,r,value)=>{checkStudent(r.StudentUserId,r.OrganizationId);if(r.SeasonId)sameOrg(requireRef(seasons,r.SeasonId,'training season').OrganizationId,r.OrganizationId,'training');return add(kind,id,r.OrganizationId,{id,...value},r.SeasonId??null,r.StudentUserId);};
  const dateKeys=week=>Array.from({length:7},(_,i)=>new Date(Date.parse(week+'T00:00:00Z')+i*86400000).toISOString().slice(0,10));
  for(const r of rows('TrainingPreferences'))trainingAdd('training-preferences',trainingId(r),r,{...parsed(r.PreferencesJson,'training preferences'),lastEventAtUtc:iso(r.LastEventAtUtc),qualifyingWeekStarts:rows('TrainingWeeks').filter(w=>guid(w.OrganizationId)===guid(r.OrganizationId)&&guid(w.StudentUserId)===guid(r.StudentUserId)&&w.QualifiedAtUtc).map(w=>w.WeekStartLocalDate).sort().slice(0,4)});
  for(const r of rows('TrainingDays'))trainingAdd('training-day',trainingId(r,r.LocalDate),r,{localDate:r.LocalDate,timeZone:r.TimeZone,firstQualifiedAtUtc:iso(r.CreditedAtUtc),sessionId:guid(r.SessionId),credited:true});
  for(const r of rows('TrainingWeeks'))trainingAdd('training-week',trainingId(r,r.WeekStartLocalDate),r,{weekStartLocalDate:r.WeekStartLocalDate,timeZone:r.TimeZone,target:r.Target,dates:dateKeys(r.WeekStartLocalDate),creditedDates:rows('TrainingDays').filter(d=>guid(d.OrganizationId)===guid(r.OrganizationId)&&guid(d.StudentUserId)===guid(r.StudentUserId)&&d.WeekStartLocalDate===r.WeekStartLocalDate).map(d=>d.LocalDate).sort(),qualifiedAtUtc:iso(r.QualifiedAtUtc)});
  const missionHeads=new Map();
  for(const r of rows('DailyMissions')){trainingAdd('daily-mission',r.Id,r,{seasonId:guid(r.SeasonId),localDate:r.LocalDate,timeZone:r.TimeZone,revision:r.Revision,scopeVersion:r.ScopeVersion,eligibleKnowledgeUnitIds:parsed(r.EligibleIdsJson,'eligible ids'),reviewKnowledgeUnitIds:parsed(r.ReviewIdsJson,'review ids'),acceptedReviewKnowledgeUnitIds:parsed(r.AcceptedReviewIdsJson,'accepted review ids'),practiceCompleted:r.PracticeCompleted,practiceSessionId:r.PracticeSessionId?guid(r.PracticeSessionId):null,reviewSessionId:r.ReviewSessionId?guid(r.ReviewSessionId):null,invalidated:!!r.Invalidated});const head=trainingId(r,guid(r.SeasonId),r.LocalDate);if(!missionHeads.has(head)||missionHeads.get(head).Revision<r.Revision)missionHeads.set(head,r);}
  for(const[id,r]of missionHeads)trainingAdd('daily-mission-head',id,r,{missionId:r.Id,revision:r.Revision});
  for(const r of rows('TrainingSeasonProgress'))trainingAdd('training-season-progress',trainingId(r,guid(r.SeasonId),r.ScopeVersion),r,{seasonId:guid(r.SeasonId),scopeVersion:r.ScopeVersion,seenKnowledgeUnitIds:parsed(r.SeenIdsJson,'seen ids'),counters:Object.fromEntries(parsed(r.BadgesJson,'badge counters').map(b=>[b.key,[b.completed,b.target]]))});
  for(const r of rows('SoloBadgeAwards')){const e=parsed(r.EvidenceJson,'award evidence');trainingAdd('solo-badge-award',trainingId(r,r.Key,r.RuleVersion,r.AwardScope),r,{...e.badge,seasonId:r.SeasonId?guid(r.SeasonId):null,scopeVersion:e.scopeVersion,eligibleKnowledgeUnitIds:e.eligibleKnowledgeUnitIds,...(e.evidence?{evidence:e.evidence}:{}),earnedAtUtc:iso(r.EarnedAtUtc),evidenceSessionId:guid(r.SessionId)});}
  for(const r of rows('PracticeRoomRecord'))if(!['Completed','Abandoned'].includes(r.Status))fail('finish or abandon every legacy PVP room before cutover; active timers cannot be converted');
  for(const r of rows('PracticeSetting'))add('practice-setting',guid(r.OrganizationId),r.OrganizationId,{enabled:!!r.Enabled});
  for(const r of rows('PracticeQuestionRecord')) {
    sameOrg(requireRef(seasons,r.SeasonId,'practice question season').OrganizationId,r.OrganizationId,'practice question');
    const q=parsed(r.DefinitionJson,'practice question');q.id=guid(q.id);q.contentPackId=guid(q.contentPackId);q.sourceUnitId=guid(q.sourceUnitId);
    sourceOrg(requireRef(sources,q.sourceUnitId,'practice question source'),r.OrganizationId,'practice question source');
    if(guid(r.QuestionKey)!==q.id||r.Version!==q.version||guid(requireRef(sources,q.sourceUnitId,'source').ContentPackId)!==q.contentPackId)fail('practice question identity mismatch');
    if(!['ShortAnswer','List','ExactWords','TrueFalse'].includes(q.kind)||![q.prompt,q.evidence,q.reference].every(s=>typeof s==='string'&&s.trim()&&s.length<=10000)||!Number.isSafeInteger(q.version)||q.version<1||typeof q.ordered!=='boolean')fail('unsupported practice question definition');
    if(!Array.isArray(q.parts)||q.parts.length<1||q.parts.length>50||q.parts.some(p=>!Number.isSafeInteger(p.points)||p.points<1||p.points>100||!Array.isArray(p.acceptedAnswers)||p.acceptedAnswers.length<1||p.acceptedAnswers.length>50||p.acceptedAnswers.some(a=>typeof a!=='string'||!a.trim()||a.length>2000)))fail('practice question exceeds native answer limits');
    const normal=a=>a.normalize('NFC').trim().replace(/\s+/gu,' ').toUpperCase();
    if(q.kind==='TrueFalse'&&(q.parts.length!==1||q.parts[0].acceptedAnswers.some(a=>!['TRUE','FALSE'].includes(normal(a)))||new Set(q.parts[0].acceptedAnswers.map(normal)).size!==1))fail('invalid true-false question');
    const key=`${q.id}:${q.version}`;add('question',key,r.OrganizationId,{id:key,legacyRecordId:guid(r.Id),seasonId:guid(r.SeasonId),published:!!r.Published,question:q},r.SeasonId);
  }
  // Immutable legacy PVP evidence remains queryable in archives; no clock or scoring evidence is invented.
  // Every source row is retained verbatim, including original IDs and JSON strings, so adaptation is reversible.
  const firstOrg=[...orgs.keys()][0];
  for(const [table,data] of Object.entries(tables))for(const [n,r] of data.entries()) {
    let org=r.OrganizationId?guid(r.OrganizationId):null;
    if(table==='Organizations')org=guid(r.Id);
    if(table==='Users')org=userOrg.get(guid(r.Id));
    if(!org&&r.UserId)org=userOrg.get(guid(r.UserId));
    if(!org&&r.ContentPackId)org=guid(requireRef(packs,r.ContentPackId,'archive pack').OrganizationId);
    if(!org&&r.SourceUnitId)org=guid(requireRef(sources,r.SourceUnitId,'archive source').OrganizationId);
    if(!org&&r.QuestionCandidateId)org=guid(rows('QuestionCandidates').find(q=>guid(q.Id)===guid(r.QuestionCandidateId))?.OrganizationId??fail('archive question not found'));
    if(!org&&r.AssignmentId)org=guid(rows('Assignments').find(a=>guid(a.Id)===guid(r.AssignmentId))?.OrganizationId??fail('archive assignment not found'));
    const key=r.Id??r.MigrationId??hash(JSON.stringify(r));
    add(`legacy:${table}`,String(key),org??firstOrg,{sourceTable:table,sourceRow:r,sourceRowOrdinal:n},r.SeasonId??null);
  }
  if(libraryPacks.length)add('library-version','nkjv-v1',libraryOrg,canonicalLibrary.get('library-version:nkjv-v1'));
  const keys=new Set();for(const r of native.records){const key=`${r.kind}:${r.id}:${r.org_id}`;if(keys.has(key))fail('duplicate native record identity');keys.add(key);}
  const manifest={formatVersion:1,sourceCounts:Object.fromEntries(Object.entries(tables).map(([name,data])=>[name,data.length])),nativeCounts:{organizations:native.organizations.length,users:native.users.length,records:native.records.length},archivedPvpRooms:rows('PracticeRoomRecord').length,reconstructedAttemptFeedback:convertedAttempts.filter(a=>a.feedbackReconstructed).length,cookiesMigrated:false,warnings:[]};
  if(rows('PracticeRoomRecord').length||rows('PracticeAwardRecord').length)manifest.warnings.push('Legacy PVP rooms and awards are preserved as archive records only; native room history/trends and achievement projections require a separate validated projection.');
  return {native,manifest};
}

export async function exportDatabase(sourcePath, outputDirectory) {
  const source=resolve(sourcePath),out=resolve(outputDirectory);
  if(source===resolve(out,'native-roundtrip.db'))fail('output would overwrite source');
  const snapshot=readSource(source),{native,manifest}=convertSnapshot(snapshot);
  const schema=await readFile(resolve(root,'apps/web/migrations/0001_native.sql'),'utf8');
  const statements=[];
  for(const [table,list] of [['Organizations',native.organizations],['Users',native.users],['Records',native.records]])for(const row of list){const values={...row};if(table==='Records')values.data=JSON.stringify(values.data);statements.push(`INSERT INTO ${table} (${Object.keys(values).join(',')}) VALUES (${Object.values(values).map(quote).join(',')});`);}
  const sql=`${schema}\n${statements.join('\n')}\n`;
  if(statements.some(statement=>Buffer.byteLength(statement)>100000))fail('a SQL statement exceeds the D1 100 KB statement limit; use a reviewed bound-parameter importer');
  // Round trip through SQLite's real constraints before emitting an importable file.
  const db=new DatabaseSync(':memory:');
  try {
    db.exec(sql);
    if(db.prepare('PRAGMA foreign_key_check').all().length)fail('native foreign keys failed');
    for(const [name,count] of Object.entries(manifest.sourceCounts))if(db.prepare('SELECT count(*) AS n FROM Records WHERE kind=?').get(`legacy:${name}`).n!==count)fail('archive row counts changed');
    if(db.prepare('SELECT count(*) AS n FROM Sessions').get().n!==0)fail('authentication sessions must not migrate');
    for(const user of native.users)if(db.prepare('SELECT password_hash FROM Users WHERE id=?').get(user.id).password_hash!==user.password_hash)fail('credential hash changed');
    for(const record of native.records){const restored=db.prepare('SELECT data FROM Records WHERE kind=? AND id=? AND org_id=?').get(record.kind,record.id,record.org_id);if(restored.data!==JSON.stringify(record.data))fail('native record roundtrip changed');}
  } finally {db.close();}
  const sourceSchema=JSON.stringify(snapshot.definitions,null,2)+'\n';
  manifest.sqlSha256=hash(sql);manifest.sourceSchemaSha256=hash(sourceSchema);manifest.verifiedRoundtrip=true;
  await mkdir(out,{recursive:true});
  await writeFile(resolve(out,'native.sql'),sql,{flag:'wx',mode:0o600});
  await writeFile(resolve(out,'source-schema.json'),sourceSchema,{flag:'wx',mode:0o600});
  await writeFile(resolve(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  return manifest;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2),option=name=>{const index=args.indexOf(name);return index<0?undefined:args[index+1];};
  if(args.includes('--help')) {console.log('Usage: node scripts/cloudflare-export.mjs --source <offline-sqlite.db> --output <new-private-directory>\nWithout options, exports the development DB into ignored test-results/migration. No remote writes.');process.exit(0);}
  if(args.some((arg,i)=>i%2===0?!['--source','--output'].includes(arg):arg.startsWith('--'))||args.length%2!==0){console.error('Expected --source <path> and/or --output <path>. Use --help.');process.exit(1);}
  const source=option('--source')??resolve(root,'apps/api/src/Erudoza.Api/erudoza.dev.db');
  const output=option('--output')??resolve(root,'apps/web/test-results/migration',new Date().toISOString().replaceAll(':','-'));
  exportDatabase(source,output).then(manifest=>console.log(JSON.stringify({output:resolve(output),...manifest},null,2))).catch(error=>{console.error(error.message);process.exitCode=1;});
}
