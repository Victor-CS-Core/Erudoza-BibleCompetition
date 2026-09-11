import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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
    const schema=await readFile('apps/web/migrations/0001_native.sql','utf8');for(const statement of schema.split(';').filter(s=>s.trim()))await db.prepare(statement).run();
    for(const [table,rows]of [['Organizations',native.organizations],['Users',native.users],['Records',native.records]])for(const record of rows){const row={...record};if(table==='Records')row.data=JSON.stringify(row.data);await db.prepare(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).bind(...Object.values(row)).run();}
    const session=native.records.find(r=>r.kind==='session'&&r.data.cards.length&&r.data.attempts.length).data;
    const user=native.users.find(u=>u.id===session.studentUserId),token='synthetic-migration-test-session';
    await db.prepare('INSERT INTO Sessions(token_hash,user_id,credential_version,expires_at) VALUES(?,?,?,?)').bind(createHash('sha256').update(token).digest('base64'),user.id,user.credential_version,Date.now()+60000).run();
    const response=await runtime.dispatchFetch(`https://migration.test/api/v1/study/sessions/${session.id}`,{headers:{Cookie:`__Host-erudoza.session=${token}`}});
    assert.equal(response.status,200);const result=await response.json();assert.equal(result.card.id,session.cards.at(-1).id);assert.equal(result.card.debugAnswer,null);assert.equal(result.attempt.canonicalAnswer,session.attempts.at(-1).result.canonicalAnswer);assert.equal(result.attempt.attemptId,session.attempts.at(-1).id);assert.equal(result.summary.attempted,session.attempts.length);
  } finally {await runtime.dispose();}
});
