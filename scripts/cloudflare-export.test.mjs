import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { readSource, convertSnapshot, exportDatabase } from './cloudflare-export.mjs';

const source=resolve('apps/api/src/Erudoza.Api/erudoza.dev.db');
const fixture=()=>structuredClone(readSource(source));
test('actual EF snapshot roundtrips every row and credential hash without changing the source database',async()=>{
  const before=createHash('sha256').update(await readFile(source)).digest('hex');
  const {mkdir}=await import('node:fs/promises');await mkdir('apps/web/test-results',{recursive:true});
  const out=await mkdtemp(resolve('apps/web/test-results/migration-test-'));
  const manifest=await exportDatabase(source,out);
  assert.equal(manifest.verifiedRoundtrip,true);assert.equal(manifest.cookiesMigrated,false);
  const sql=await readFile(resolve(out,'native.sql'),'utf8'),db=new DatabaseSync(':memory:');db.exec(sql);
  try {
    const snap=fixture();
    for(const [table,rows]of Object.entries(snap.tables))assert.equal(db.prepare('SELECT count(*) AS n FROM Records WHERE kind=?').get(`legacy:${table}`).n,rows.length);
    for(const user of snap.tables.Users)assert.equal(db.prepare('SELECT password_hash FROM Users WHERE id=?').get(user.Id.toLowerCase()).password_hash,user.PasswordHash);
    for(const card of snap.tables.ChallengeCards){const row=db.prepare("SELECT data FROM Records WHERE kind='session' AND id=?").get(card.SessionId.toLowerCase());const embedded=JSON.parse(row.data).cards.find(c=>c.id===card.Id.toLowerCase());assert.equal(embedded.answerKey.canonicalAnswer,JSON.parse(card.AnswerKeyJson).CanonicalAnswer);}
  } finally {db.close();}
  assert.equal(createHash('sha256').update(await readFile(source)).digest('hex'),before);
  await assert.rejects(exportDatabase(source,out),/EEXIST/);
});
test('rejects unsupported organization membership and scope conversions',()=>{
  const multi=fixture();multi.tables.OrganizationMembers.push({...multi.tables.OrganizationMembers[0],Id:'11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa'});
  assert.throws(()=>convertSnapshot(multi),/exactly one organization membership/);
  const scopes=fixture();scopes.tables.AssignmentScopes.push({...scopes.tables.AssignmentScopes[0],Id:'11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa'});
  assert.throws(()=>convertSnapshot(scopes),/exactly one scope/);
  const rules=fixture();rules.tables.RuleProfiles[0].Version=99;assert.throws(()=>convertSnapshot(rules),/rule profiles/);
  const broken=fixture();delete broken.tables.SourceUnits[0].CanonicalText;assert.throws(()=>convertSnapshot(broken),/required column/);
});
test('preserves multiple book references in one season without duplicating source text',()=>{
  const snap=fixture(),first=snap.tables.ScopeEntries[0],pack=snap.tables.ContentPacks.find(p=>p.Id===first.ContentPackId);
  const second={...pack,Id:'33333333-aaaa-4aaa-8aaa-aaaaaaaaaaaa',PackKey:'second-book'};
  snap.tables.ContentPacks.push(second);
  snap.tables.ScopeEntries.push({...first,Id:'44444444-aaaa-4aaa-8aaa-aaaaaaaaaaaa',ContentPackId:second.Id});
  const {native}=convertSnapshot(snap),scope=native.records.find(r=>r.kind==='scope'&&r.id===first.SeasonId.toLowerCase());
  assert.equal(scope.data.packs.length,2);assert.equal(scope.data.contentPackId,null);
  assert.equal(native.records.filter(r=>r.kind==='source').length,snap.tables.SourceUnits.length);
});
test('rejects live PVP timers while preserving completed raw scoring evidence',()=>{
  const snap=fixture(),s=snap.tables.Seasons[0];
  const evidence={id:'11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa',submissions:[{elapsedTicks:81234567,accuracyHundredths:100,speedHundredths:24}]};
  snap.tables.PracticeRoomRecord=[{Id:evidence.id,OrganizationId:s.OrganizationId,SeasonId:s.Id,Status:'Playing',Revision:7,StateJson:JSON.stringify(evidence),UpdatedAt:'2026-09-10T00:00:00Z'}];
  assert.throws(()=>convertSnapshot(snap),/finish or abandon every legacy PVP room/);
  snap.tables.PracticeRoomRecord[0].Status='Completed';
  const converted=convertSnapshot(snap);const raw=converted.native.records.find(r=>r.kind==='legacy:PracticeRoomRecord');
  assert.equal(raw.data.sourceRow.StateJson,JSON.stringify(evidence));assert.equal(converted.manifest.archivedPvpRooms,1);assert.equal(converted.manifest.warnings.length,1);
});
test('retains legacy duplicates separately and explicitly marks reconstructed feedback',()=>{
  const snap=fixture();const attempt=snap.tables.Attempts[0];attempt.ResultJson=null;
  snap.tables.Attempts.push({...attempt,Id:'11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa',IsLegacyDuplicate:1,ClientSubmissionId:'legacy-duplicate'});
  const {native,manifest}=convertSnapshot(snap),session=native.records.find(r=>r.kind==='session'&&r.id===attempt.SessionId.toLowerCase());
  assert.equal(session.data.attempts.length,1);assert.equal(native.records.filter(r=>r.kind==='attempt').length,2);assert.equal(manifest.reconstructedAttemptFeedback,2);
});
test('imports actual converted records into Miniflare and resumes original immutable card and attempt',async()=>{
  const {native}=convertSnapshot(fixture());
  const bundle=await build({entryPoints:['apps/web/worker/native/index.ts'],bundle:true,write:false,format:'esm',platform:'neutral',target:'es2022',external:['cloudflare:workers']});
  const runtime=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-05-22',d1Databases:{DB:'migration-test'},durableObjects:{ROOMS:{className:'PracticeRoom',useSQLite:true},REPORTS:{className:'PracticeReports',useSQLite:true}},bindings:{PUBLIC_ORIGIN:'https://migration.test'}});
  try {
    const db=await runtime.getD1Database('DB');
    await applyAllNativeMigrations(db);
    for(const [table,rows]of [['Organizations',native.organizations],['Users',native.users],['Records',native.records]])for(const record of rows){const row={...record};if(table==='Records')row.data=JSON.stringify(row.data);await db.prepare(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).bind(...Object.values(row)).run();}
    const session=native.records.find(r=>r.kind==='session'&&r.data.cards.length&&r.data.attempts.length).data;
    const user=native.users.find(u=>u.id===session.studentUserId),token='synthetic-migration-test-session';
    await db.prepare('INSERT INTO Sessions(token_hash,user_id,credential_version,expires_at) VALUES(?,?,?,?)').bind(createHash('sha256').update(token).digest('base64'),user.id,user.credential_version,Date.now()+60000).run();
    const response=await runtime.dispatchFetch(`https://migration.test/api/v1/study/sessions/${session.id}`,{headers:{Cookie:`__Host-erudoza.session=${token}`}});
    assert.equal(response.status,200);const result=await response.json();assert.equal(result.card.id,session.cards.at(-1).id);assert.equal(result.card.debugAnswer,null);assert.equal(result.attempt.canonicalAnswer,session.attempts.at(-1).result.canonicalAnswer);assert.equal(result.attempt.attemptId,session.attempts.at(-1).id);assert.equal(result.summary.attempted,session.attempts.length);
  } finally {await runtime.dispose();}
});
test('preserves populated Honors projections, pending boundary and immutable skill evidence',()=>{
  const snap=fixture(),s=snap.tables.StudySessions[0],a=snap.tables.Attempts.find(x=>x.SessionId===s.Id)??snap.tables.Attempts[0];
  const org=s.OrganizationId,student=s.StudentUserId,season=s.SeasonId,session=s.Id,at='2026-09-11T16:00:00.000Z';
  const base={OrganizationId:org,StudentUserId:student},mid=[org,student,season,'2026-09-11','1'].map(x=>x.toLowerCase()).join(':');
  const prefs={timeZone:'America/New_York',weeklyTarget:5,pending:{timeZone:'UTC',weeklyTarget:3,effectiveAtUtc:'2026-09-14T04:00:00.000Z'}};
  snap.tables.TrainingPreferences=[{...base,PreferencesJson:JSON.stringify(prefs),LastEventAtUtc:at}];
  snap.tables.TrainingDays=[{...base,LocalDate:'2026-09-11',TimeZone:prefs.timeZone,WeekStartLocalDate:'2026-09-07',CreditedAtUtc:at,SessionId:session}];
  snap.tables.TrainingWeeks=[{...base,WeekStartLocalDate:'2026-09-07',TimeZone:prefs.timeZone,Target:5,CompletedDays:1,QualifiedAtUtc:null}];
  snap.tables.DailyMissions=[{...base,Id:mid,SeasonId:season,LocalDate:'2026-09-11',TimeZone:prefs.timeZone,Revision:1,ScopeVersion:'scope',EligibleIdsJson:'[]',ReviewIdsJson:'[]',AcceptedReviewIdsJson:'[]',PracticeCompleted:8,PracticeSessionId:session,ReviewSessionId:null,Invalidated:false}];
  const badge={key:'full-coverage',ruleVersion:'training-v1',title:'Full Coverage',completed:1,target:1,earnedAtUtc:at,scopeLabel:'Assigned scope (1 passages)',evidenceSessionId:session.toLowerCase()};
  snap.tables.TrainingSeasonProgress=[{...base,SeasonId:season,ScopeVersion:'scope',SeenIdsJson:'[]',BadgesJson:JSON.stringify([badge])}];
  snap.tables.SoloBadgeAwards=[{...base,SeasonId:season,Key:badge.key,RuleVersion:'training-v1',AwardScope:season.toLowerCase(),EarnedAtUtc:at,SessionId:session,EvidenceJson:JSON.stringify({badge,scopeVersion:'scope',eligibleKnowledgeUnitIds:[]})}];
  const skills={exactWording:18,recognition:10,reference:0,sequence:0,factualRecall:0};a.BeforeSkillsJson=JSON.stringify({...skills,exactWording:0});a.AfterSkillsJson=JSON.stringify(skills);
  s.TrainingJson=JSON.stringify({missionId:mid,missionRevision:1,missionLocalDate:'2026-09-11',timeZone:prefs.timeZone,reviewKnowledgeUnitIds:[],creditedLocalDate:'2026-09-11',newlyCreditedDay:true,earnedBadges:[badge]});s.RecapJson=JSON.stringify({version:'training-v1',sessionId:session.toLowerCase(),passageChanges:[],earnedBadges:[badge]});
  const {native}=convertSnapshot(snap),find=kind=>native.records.find(x=>x.kind===kind).data;
  assert.deepEqual(find('training-preferences').pending,prefs.pending);assert.equal(find('training-day').firstQualifiedAtUtc,at);assert.equal(find('training-week').creditedDates.length,1);assert.equal(find('daily-mission-head').missionId,mid);assert.deepEqual(find('solo-badge-award').eligibleKnowledgeUnitIds,[]);
  assert.deepEqual(native.records.find(x=>x.kind==='attempt'&&x.id===a.Id.toLowerCase()).data.after,skills);assert.deepEqual(native.records.find(x=>x.kind==='session'&&x.id===session.toLowerCase()).data.recap,JSON.parse(s.RecapJson));
});
test('exports the immutable winning chapter subset and label without broadening its scope',()=>{
  const snap=fixture(),s=snap.tables.StudySessions[0],knowledge=snap.tables.KnowledgeUnits[0].Id.toLowerCase();
  const badge={key:'chapter-strong',ruleVersion:'training-v1',title:'Chapter Strong',completed:1,target:1,earnedAtUtc:'2026-09-11T16:00:00.000Z',scopeLabel:'Assigned scope · DAN 1 (1 passages)',evidenceSessionId:s.Id.toLowerCase()};
  snap.tables.SoloBadgeAwards=[{OrganizationId:s.OrganizationId,StudentUserId:s.StudentUserId,SeasonId:s.SeasonId,Key:badge.key,RuleVersion:badge.ruleVersion,AwardScope:s.SeasonId.toLowerCase(),EarnedAtUtc:badge.earnedAtUtc,SessionId:s.Id,EvidenceJson:JSON.stringify({badge,scopeVersion:'full-season-fingerprint',eligibleKnowledgeUnitIds:[knowledge],evidence:{skills:[{knowledgeUnitId:knowledge,algorithmVersion:'v2-skill-evidence',scores:{exactWording:70,recognition:70,reference:0,sequence:0,factualRecall:0}}]}})}];
  const award=convertSnapshot(snap).native.records.find(r=>r.kind==='solo-badge-award').data;
  assert.deepEqual(award.eligibleKnowledgeUnitIds,[knowledge]);assert.equal(award.scopeLabel,badge.scopeLabel);assert.equal(award.scopeVersion,'full-season-fingerprint');assert.equal(award.evidence.skills.length,1);
});

async function applyAllNativeMigrations(db) {
  const names=(await readdir('apps/web/migrations')).filter(name=>name.endsWith('.sql')).sort();
  for(const name of names){const sql=await readFile(`apps/web/migrations/${name}`,'utf8');await db.batch(sql.split(';').filter(s=>s.trim()).map(s=>db.prepare(s)));}
  return names;
}
function populatedHonorsFixture() {
  const snap=fixture(),original=snap.tables.Attempts[0],s=snap.tables.StudySessions.find(s=>s.Id===original.SessionId),card=snap.tables.ChallengeCards.find(c=>c.Id===original.ChallengeCardId);
  const id=value=>value.toLowerCase(),org=id(s.OrganizationId),student=id(s.StudentUserId),season=id(s.SeasonId),session=id(s.Id),knowledge=id(original.KnowledgeUnitId);
  const now=new Date(),day=now.toISOString().slice(0,10),midnight=Date.parse(`${day}T00:00:00Z`),monday=new Date(midnight-((now.getUTCDay()+6)%7)*86400000).toISOString().slice(0,10),at=i=>new Date(midnight+1000+i).toISOString();
  const mid=`${org}:${student}:${season}:${day}:1`,fingerprint=createHash('sha256').update(knowledge).digest('hex'),clientStartId='converted-honors-start';
  const start={seasonId:season,mode:'Practice',training:{clientStartId,timeZone:'UTC',step:'Practice'}};
  const prefs={timeZone:'UTC',weeklyTarget:5,pending:{timeZone:'America/New_York',weeklyTarget:3,effectiveAtUtc:new Date(Date.parse(`${monday}T00:00:00Z`)+7*86400000).toISOString()}};
  const zero={exactWording:0,recognition:0,reference:0,sequence:0,factualRecall:0},events=[];let before=zero,previous=null;
  snap.tables.Attempts=snap.tables.Attempts.filter(a=>a.SessionId!==s.Id);snap.tables.ChallengeCards=snap.tables.ChallengeCards.filter(c=>c.SessionId!==s.Id);
  for(let i=1;i<=8;i++){
    const cid=randomUUID(),aid=randomUUID(),after={...zero,exactWording:Math.min(70,18*i),recognition:10*i};
    const result={...JSON.parse(original.ResultJson),AttemptId:aid,IsCorrect:true,MasteryLevel:i>=4?'Strong':'Review',ExactWordingScore:after.exactWording,AlreadyProcessed:false};
    // ResultJson supports the canonical PascalCase serializer as well as web JSON.
    delete result.attemptId;delete result.isCorrect;delete result.masteryLevel;delete result.exactWordingScore;delete result.alreadyProcessed;
    snap.tables.ChallengeCards.push({...card,Id:cid,Sequence:i,CreatedAtUtc:at(i)});
    snap.tables.Attempts.push({...original,Id:aid,ChallengeCardId:cid,ClientSubmissionId:`converted-${i}`,IsCorrect:1,CreatedAtUtc:at(i),BeforeSkillsJson:JSON.stringify(before),AfterSkillsJson:JSON.stringify(after),PreviousAttemptId:previous,ResultJson:JSON.stringify(result)});
    events.push({attemptId:aid,acceptedAtUtc:at(i),before,after});before=after;previous=aid;
  }
  const source=snap.tables.SourceUnits.find(x=>id(x.Id)===id(card.SourceUnitId));
  const badge=(key,title,index,label)=>({key,ruleVersion:'training-v1',title,completed:1,target:1,earnedAtUtc:at(index),scopeLabel:label,evidenceSessionId:session});
  const awards=[badge('full-coverage','Full Coverage',1,'Assigned scope (1 passages)'),badge('chapter-strong','Chapter Strong',4,`Assigned scope · ${source.BookKey} ${source.Chapter} (1 passages)`)];
  const steps=[{kind:'Review',target:0,completed:0,status:'NotNeeded',sessionId:null},{kind:'Practice',target:8,completed:8,status:'Complete',sessionId:session}];
  const recap={version:'training-v1',sessionId:session,seasonId:season,mode:'Practice',completedAtUtc:at(9),attempted:8,correct:8,targetCardCount:8,fullTargetReached:true,newlyCreditedDay:true,missionLocalDate:day,creditedLocalDate:day,missionSteps:steps,earnedBadges:awards,passageChanges:[{knowledgeUnitId:knowledge,title:source.CitationLabel,delta:before,before:zero,after:before,events}]};
  const base={OrganizationId:org,StudentUserId:student};
  Object.assign(s,{Status:3,TargetCardCount:8,CreatedAtUtc:at(0),CompletedAtUtc:at(9),ClientStartId:clientStartId,StartPayloadJson:JSON.stringify({...start,mode:1}),TrainingJson:JSON.stringify({clientStartId,startPayload:JSON.stringify({...start,mode:1,training:{...start.training,missionId:null,missionRevision:null}}),missionId:mid,missionRevision:1,missionLocalDate:day,timeZone:'UTC',reviewKnowledgeUnitIds:[],creditedLocalDate:day,newlyCreditedDay:true,earnedBadges:awards}),RecapJson:JSON.stringify(recap)});
  const mastery=snap.tables.MasteryStates.find(x=>id(x.SeasonId)===season&&id(x.StudentUserId)===student&&id(x.KnowledgeUnitId)===knowledge);
  Object.assign(mastery,{ExactWordingScore:70,RecognitionScore:80,ReferenceScore:0,SequenceScore:0,FactualRecallScore:0,Level:4,AlgorithmVersion:'v2-skill-evidence',LastAttemptId:previous,UpdatedAtUtc:at(8)});
  snap.tables.TrainingPreferences=[{...base,PreferencesJson:JSON.stringify(prefs),LastEventAtUtc:at(8)}];
  snap.tables.TrainingDays=[{...base,LocalDate:day,TimeZone:'UTC',WeekStartLocalDate:monday,CreditedAtUtc:at(8),SessionId:session}];
  snap.tables.TrainingWeeks=[{...base,WeekStartLocalDate:monday,TimeZone:'UTC',Target:5,CompletedDays:1,QualifiedAtUtc:null}];
  snap.tables.DailyMissions=[{...base,Id:mid,SeasonId:season,LocalDate:day,TimeZone:'UTC',Revision:1,ScopeVersion:fingerprint,EligibleIdsJson:JSON.stringify([knowledge]),ReviewIdsJson:'[]',AcceptedReviewIdsJson:'[]',PracticeCompleted:8,PracticeSessionId:session,ReviewSessionId:null,Invalidated:false}];
  const counters=[['exact-recall',0,5],['reference-ready',0,10],['chapter-strong',1,1],['full-coverage',1,1],['steady-study',0,4],['review-complete',0,1]];
  snap.tables.TrainingSeasonProgress=[{...base,SeasonId:season,ScopeVersion:fingerprint,SeenIdsJson:JSON.stringify([knowledge]),BadgesJson:JSON.stringify(counters.map(([key,completed,target])=>awards.find(a=>a.key===key)??{key,ruleVersion:'training-v1',title:{'exact-recall':'Exact Recall','reference-ready':'Reference Ready','steady-study':'Steady Study','review-complete':'Review Complete'}[key],completed,target,earnedAtUtc:null,scopeLabel:key==='steady-study'?'Academy practice weeks':key==='review-complete'?'Daily review (0 passages)':'Assigned scope ('+target+' passages)',evidenceSessionId:null}))}];
  snap.tables.SoloBadgeAwards=awards.map(badge=>({...base,SeasonId:season,Key:badge.key,RuleVersion:'training-v1',AwardScope:season,EarnedAtUtc:badge.earnedAtUtc,SessionId:session,EvidenceJson:JSON.stringify({badge,scopeVersion:fingerprint,eligibleKnowledgeUnitIds:[knowledge],evidence:{missionId:mid,qualifyingWeekStarts:[],skills:[{knowledgeUnitId:knowledge,algorithmVersion:'v2-skill-evidence',scores:events[badge.key==='full-coverage'?0:3].after}]}})}));
  return {snap,start,recap,prefs,awards,counters,day,monday,mid,fingerprint,session,season,student,org};
}
test('all-migration native runtime reads and replays populated canonical Honors without changing credit or recap',async()=>{
  const expected=populatedHonorsFixture(),{native}=convertSnapshot(expected.snap);
  const bundle=await build({entryPoints:['apps/web/worker/native/index.ts'],bundle:true,write:false,format:'esm',platform:'neutral',target:'es2022',external:['cloudflare:workers']});
  const runtime=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-05-22',d1Databases:{DB:'honors-export-test'},durableObjects:{ROOMS:{className:'PracticeRoom',useSQLite:true},REPORTS:{className:'PracticeReports',useSQLite:true}},bindings:{PUBLIC_ORIGIN:'https://migration.test'}});
  try{
    const db=await runtime.getD1Database('DB');const migrations=await applyAllNativeMigrations(db);assert.ok(migrations.includes('0004_training_progression.sql'));
    for(const [table,rows]of [['Organizations',native.organizations],['Users',native.users],['Records',native.records]])for(const record of rows){const row={...record};if(table==='Records')row.data=JSON.stringify(row.data);await db.prepare(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).bind(...Object.values(row)).run();}
    const user=native.users.find(u=>u.id===expected.student),token='synthetic-populated-export-session';await db.prepare('INSERT INTO Sessions(token_hash,user_id,credential_version,expires_at) VALUES(?,?,?,?)').bind(createHash('sha256').update(token).digest('base64'),user.id,user.credential_version,Date.now()+300000).run();
    const request=async(path,method='GET',body)=>{const response=await runtime.dispatchFetch(`https://migration.test/api/v1${path}`,{method,headers:{Cookie:`__Host-erudoza.session=${token}`,Origin:'https://migration.test','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert.equal(response.status,200,`${method} ${path}: ${await response.clone().text()}`);return response.json();};
    const projectionSnapshot=async()=> (await db.prepare("SELECT kind,id,data,revision FROM Records WHERE kind IN ('training-preferences','training-day','training-week','daily-mission','daily-mission-head','training-season-progress','solo-badge-award','session','attempt','mastery') ORDER BY kind,id").all()).results;
    const before=await projectionSnapshot();
    const resumed=await request(`/study/sessions/${expected.session}`);assert.equal(resumed.summary.status,'Completed');assert.equal(resumed.summary.attempted,8);assert.deepEqual(resumed.summary.recap,expected.recap);assert.equal(resumed.attempt.attemptId,expected.recap.passageChanges[0].events.at(-1).attemptId);
    assert.deepEqual(await request(`/study/sessions/${expected.session}/recap`),expected.recap);
    const replay=await request('/study/sessions','POST',expected.start);assert.equal(replay.id,expected.session);
    const complete=await request(`/study/sessions/${expected.session}/complete`,'POST');assert.deepEqual(complete.recap,expected.recap);assert.equal(complete.status,'Completed');
    const today=await request(`/progress/me/today?seasonId=${expected.season}`),honors=await request(`/progress/me/honors?seasonId=${expected.season}`);
    assert.deepEqual(Object.keys(today).sort(),['seasonId','seasonName','seasonStatus','localDate','preferences','week','mission','nextAction','honors'].sort());
    assert.equal(today.seasonId,expected.season);assert.equal(today.seasonStatus,'Active');assert.equal(today.localDate,expected.day);assert.deepEqual(today.preferences,expected.prefs);assert.equal(today.week.weekStartLocalDate,expected.monday);assert.equal(today.week.completedDays,1);assert.equal(today.week.target,5);assert.equal(today.week.days.filter(d=>d.credited).length,1);
    assert.deepEqual(today.mission,{id:expected.mid,revision:1,status:'Complete',scopeVersion:expected.fingerprint,steps:expected.recap.missionSteps,explanation:null});assert.equal(today.nextAction,null);assert.deepEqual(today.honors,honors);
    assert.deepEqual(honors.map(b=>[b.key,b.completed,b.target]),expected.counters);
    for(const badge of honors)assert.deepEqual(Object.keys(badge).sort(),['key','ruleVersion','title','completed','target','earnedAtUtc','scopeLabel','evidenceSessionId'].sort());
    for(const award of expected.awards)assert.deepEqual(honors.find(b=>b.key===award.key),award);
    assert.deepEqual(await projectionSnapshot(),before,'GETs, repeated start and completion must preserve imported evidence and single day credit');
  } finally {await runtime.dispose();}
});
