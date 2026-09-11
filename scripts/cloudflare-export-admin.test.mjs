import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash, pbkdf2Sync } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { listAdministrators, exportAdministrator } from './cloudflare-export-admin.mjs';

const parent=resolve('apps/web/test-results/migration');
const adminId='22222222-2222-4222-8222-222222222222', otherAdmin='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const studentId='33333333-3333-4333-8333-333333333333', orgId='11111111-1111-4111-8111-111111111111';
const salt=Buffer.alloc(16,7), credential=`pbkdf2:${salt.toString('base64')}:${pbkdf2Sync('FixtureAdmin!234',salt,100000,32,'sha256').toString('base64')}`;
async function fixture() {
  await mkdir(parent,{recursive:true});const directory=await mkdtemp(join(parent,'admin-test-')),source=join(directory,'source.db');
  const db=new DatabaseSync(source);
  db.exec(`CREATE TABLE Organizations(Id TEXT PRIMARY KEY,Name TEXT,Slug TEXT);
    CREATE TABLE Users(Id TEXT PRIMARY KEY,UserName TEXT,Email TEXT,DisplayName TEXT,Kind INTEGER,IsActive INTEGER,PasswordHash TEXT,SecurityStamp TEXT);
    CREATE TABLE OrganizationMembers(Id TEXT,UserId TEXT,OrganizationId TEXT,Role INTEGER);
    CREATE TABLE StudySessions(Id TEXT,Payload TEXT);CREATE TABLE SourceUnits(Id TEXT,CanonicalText TEXT);`);
  db.prepare('INSERT INTO Organizations VALUES(?,?,?)').run(orgId,"O'Hare Academy",'main-academy');
  const user=db.prepare('INSERT INTO Users VALUES(?,?,?,?,?,?,?,?)'),member=db.prepare('INSERT INTO OrganizationMembers VALUES(?,?,?,?)');
  for(const [id,name,kind,role] of [[adminId,'admin@example.test',1,2],[otherAdmin,'isolation@example.test',1,2],[studentId,'student',2,3]]) {
    user.run(id,name,name.includes('@')?name:null,name,kind,1,credential,'fixture-security-stamp');member.run(id,id,orgId,role);
  }
  db.exec("INSERT INTO StudySessions VALUES('historical-session','Private historical answer');INSERT INTO SourceUnits VALUES('old-source','Private historical text');");db.close();
  return {directory,source,output:join(directory,'export')};
}
const digest=async path=>createHash('sha256').update(await readFile(path)).digest('hex');
async function target() {const db=new DatabaseSync(':memory:');db.exec(await readFile('apps/web/migrations/0001_native.sql','utf8'));return db;}

test('administrator inventory omits students and credentials',async()=>{
  const f=await fixture(),admins=listAdministrators(f.source);
  assert.deepEqual(admins.map(a=>a.userId),[adminId,otherAdmin]);
  assert.equal(JSON.stringify(admins).includes(credential),false);
  assert.equal(JSON.stringify(admins).includes('fixture-security-stamp'),false);
  assert.equal(admins[0].organizationName,"O'Hare Academy");
});

test('exports only the explicit admin and organization; retains login hash and changes no source bytes',async()=>{
  const f=await fixture(),before=await digest(f.source),manifest=await exportAdministrator(f.source,f.output,adminId);
  assert.deepEqual(manifest.exportedCounts,{organizations:1,users:1,records:0,sessions:0,loginLimits:0});
  assert.equal(manifest.identity.userId,adminId);assert.equal(manifest.cookiesMigrated,false);
  const sql=await readFile(join(f.output,'admin.sql'),'utf8'),manifestText=await readFile(join(f.output,'manifest.json'),'utf8');
  assert.equal(manifestText.includes(credential),false);assert.equal(sql.includes('student'),false);assert.equal(sql.includes('Private historical'),false);assert.equal(sql.includes(otherAdmin),false);
  const db=await target();try {
    db.exec(sql);db.exec(sql);
    assert.equal(db.prepare('SELECT count(*) n FROM Organizations').get().n,1);assert.equal(db.prepare('SELECT count(*) n FROM Users').get().n,1);
    const user=db.prepare('SELECT * FROM Users').get();assert.equal(user.id,adminId);assert.equal(user.org_id,orgId);assert.equal(user.password_hash,credential);assert.equal(user.credential_version,'fixture-security-stamp');assert.equal(user.role,'Admin');
    for(const table of ['Records','Sessions','LoginLimits'])assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
  } finally {db.close();}
  assert.equal(await digest(f.source),before);await assert.rejects(exportAdministrator(f.source,f.output,adminId),/exist/i);
});

test('requires explicit selection and rejects non-admin, inactive or multi-membership accounts',async()=>{
  const f=await fixture();await assert.rejects(exportAdministrator(f.source,f.output),/admin.*id|select/i);
  await assert.rejects(exportAdministrator(f.source,f.output,studentId),/active administrator/i);
  const db=new DatabaseSync(f.source);db.prepare('UPDATE Users SET IsActive=0 WHERE Id=?').run(adminId);db.close();
  await assert.rejects(exportAdministrator(f.source,f.output,adminId),/active administrator/i);
  const changed=new DatabaseSync(f.source);changed.prepare('UPDATE Users SET IsActive=1 WHERE Id=?').run(adminId);changed.prepare('INSERT INTO OrganizationMembers VALUES(?,?,?,?)').run('duplicate',adminId,orgId,2);changed.close();
  await assert.rejects(exportAdministrator(f.source,f.output,adminId),/one organization membership/i);
});

test('rejects malformed credentials and an output outside the ignored export directory',async()=>{
  const f=await fixture();await assert.rejects(exportAdministrator(f.source,resolve('apps/web/public/admin-export'),adminId),/ignored/i);
  const db=new DatabaseSync(f.source);db.prepare('UPDATE Users SET PasswordHash=? WHERE Id=?').run('pbkdf2:AAAA:AAAA',adminId);db.close();
  await assert.rejects(exportAdministrator(f.source,f.output,adminId),/credential format/i);
});

test('generated SQL refuses additional users or conflicting admin credentials without overwriting them',async()=>{
  const f=await fixture();await exportAdministrator(f.source,f.output,adminId);const sql=await readFile(join(f.output,'admin.sql'),'utf8');
  const db=await target();try {
    db.exec(sql);db.prepare('UPDATE Users SET credential_version=? WHERE id=?').run('different-credential',adminId);
    assert.throws(()=>db.exec(sql),/constraint/i);assert.equal(db.prepare('SELECT credential_version FROM Users WHERE id=?').get(adminId).credential_version,'different-credential');
    db.prepare('UPDATE Users SET credential_version=? WHERE id=?').run('fixture-security-stamp',adminId);
    db.prepare('INSERT INTO Users SELECT ?,org_id,?,NULL,display_name,kind,role,password_hash,credential_version,active FROM Users WHERE id=?').run(otherAdmin,'other-user',adminId);
    assert.throws(()=>db.exec(sql),/constraint/i);assert.equal(db.prepare('SELECT count(*) n FROM Users').get().n,2);
  } finally {db.close();}
});

test('rotates the deployment credential in the first insert without changing source credentials or leaking the secret',async()=>{
  const f=await fixture(),before=await digest(f.source),password='DeploymentFixture!234567890',passwordFile=join(f.directory,'password.txt');
  await writeFile(passwordFile,password+'\n');
  const manifest=await exportAdministrator(f.source,f.output,adminId,{newPasswordFile:passwordFile});
  assert.equal(manifest.passwordHashPreserved,false);assert.equal(manifest.credentialRotated,true);
  const sql=await readFile(join(f.output,'admin.sql'),'utf8'),manifestText=await readFile(join(f.output,'manifest.json'),'utf8');
  assert.equal(sql.includes(credential),false);assert.equal(sql.includes(password),false);assert.equal(sql.includes('UPDATE Users SET'),false);
  assert.equal(manifestText.includes(password),false);assert.equal(manifestText.includes(credential),false);
  const db=await target();try {
    db.exec(sql);db.exec(sql);const user=db.prepare('SELECT * FROM Users').get();
    const [prefix,newSalt,newHash]=user.password_hash.split(':');assert.equal(prefix,'pbkdf2');
    assert.equal(pbkdf2Sync(password,Buffer.from(newSalt,'base64'),100000,32,'sha256').toString('base64'),newHash);
    assert.notEqual(newSalt,salt.toString('base64'));assert.notEqual(user.credential_version,'fixture-security-stamp');
    assert.equal(user.id,adminId);assert.equal(user.org_id,orgId);
  } finally {db.close();}
  assert.equal(await digest(f.source),before);
});

test('rejects an empty or short deployment password before creating an export',async()=>{
  const f=await fixture(),passwordFile=join(f.directory,'password.txt');await writeFile(passwordFile,'short\n');
  await assert.rejects(exportAdministrator(f.source,f.output,adminId,{newPasswordFile:passwordFile}),/password.*12/i);
  await assert.rejects(readFile(join(f.output,'admin.sql')),/ENOENT/);
});
