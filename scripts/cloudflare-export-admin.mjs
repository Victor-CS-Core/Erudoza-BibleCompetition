import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID, pbkdf2Sync } from 'node:crypto';
import { mkdir, readFile, writeFile, realpath } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const exportRoot=resolve(root,'apps/web/test-results/migration');
const fail=message=>{throw new Error(`Admin-only migration blocked: ${message}`);};
const guid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)?value.toLowerCase():fail('select an explicit valid admin ID');
const quote=value=>value==null?'NULL':typeof value==='number'?String(value):`'${String(value).replaceAll("'","''")}'`;
const hash=value=>createHash('sha256').update(value).digest('hex');
function inside(parent,child){const path=relative(parent,child);return !!path&&path!=='..'&&!path.startsWith('..'+sep)&&!isAbsolute(path);}
function identity(row){return {userId:guid(row.userId),userName:row.userName,email:row.email,displayName:row.displayName,
  role:row.role===1?'Owner':'Admin',organizationId:guid(row.organizationId),organizationName:row.organizationName,organizationSlug:row.organizationSlug};}
const identitySql=`SELECT u.Id userId,u.UserName userName,u.Email email,u.DisplayName displayName,u.Kind kind,u.IsActive active,
  m.Role role,o.Id organizationId,o.Name organizationName,o.Slug organizationSlug
  FROM Users u JOIN OrganizationMembers m ON m.UserId=u.Id JOIN Organizations o ON o.Id=m.OrganizationId`;

/** Return only selection metadata, never password hashes or credential versions. */
export function listAdministrators(sourcePath){
  const db=new DatabaseSync(resolve(sourcePath),{readOnly:true});
  try{return db.prepare(identitySql+' WHERE u.Kind=1 AND u.IsActive=1 AND m.Role IN (1,2) ORDER BY lower(u.Id),lower(o.Id)').all().map(identity);}
  finally{db.close();}
}

async function fingerprint(source){
  const files={};
  for(const suffix of ['', '-wal']){
    try{const bytes=await readFile(source+suffix);files[suffix||'database']={sha256:hash(bytes),bytes:bytes.length};}
    catch(error){if(error.code!=='ENOENT'||suffix==='')throw error;}
  }
  return files;
}

function readAdministrator(sourcePath,adminId){
  const db=new DatabaseSync(sourcePath,{readOnly:true});
  try{
    db.exec('BEGIN');
    if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')fail('source integrity check failed');
    const rows=db.prepare(identitySql+' WHERE lower(u.Id)=?').all(adminId);
    if(!rows.length||rows.some(row=>row.kind!==1||row.active!==1||![1,2].includes(row.role)))fail('select an active administrator');
    if(rows.length!==1||db.prepare('SELECT count(*) n FROM OrganizationMembers WHERE lower(UserId)=?').get(adminId).n!==1)fail('selected admin must have exactly one organization membership');
    const publicIdentity=identity(rows[0]);
    if([publicIdentity.userName,publicIdentity.displayName,publicIdentity.organizationName,publicIdentity.organizationSlug].some(v=>typeof v!=='string'||!v.trim()))fail('selected account has invalid identity metadata');
    const privateRow=db.prepare('SELECT PasswordHash,SecurityStamp FROM Users WHERE lower(Id)=?').get(adminId);
    const parts=typeof privateRow.PasswordHash==='string'?privateRow.PasswordHash.split(':'):[];
    if(parts.length!==3||parts[0]!=='pbkdf2'||!parts.slice(1).every(s=>/^[A-Za-z0-9+/]+={0,2}$/.test(s))
      ||Buffer.from(parts[1],'base64').length!==16||Buffer.from(parts[2],'base64').length!==32
      ||parts.slice(1).some(s=>Buffer.from(s,'base64').toString('base64')!==s))fail('unsupported credential format');
    const organization={id:publicIdentity.organizationId,name:publicIdentity.organizationName,slug:publicIdentity.organizationSlug};
    const user={id:adminId,org_id:organization.id,user_name:publicIdentity.userName,email:publicIdentity.email,display_name:publicIdentity.displayName,
      kind:'Adult',role:publicIdentity.role,password_hash:privateRow.PasswordHash,credential_version:privateRow.SecurityStamp||`admin-bootstrap-${randomUUID()}`,active:1};
    const excludedUsers=db.prepare('SELECT count(*) n FROM Users WHERE lower(Id)<>?').get(adminId).n;
    db.exec('COMMIT');return {identity:publicIdentity,organization,user,excludedUsers};
  } finally{db.close();}
}

function provisioningSql({organization:o,user:u}){
  // This is a fresh-database operation. The identical artifact can finish/retry
  // a partial first application, but cannot add to an existing app or replace credentials.
  const clean=`NOT EXISTS(SELECT 1 FROM Organizations WHERE id<>${quote(o.id)}) AND NOT EXISTS(SELECT 1 FROM Users WHERE id<>${quote(u.id)}) AND NOT EXISTS(SELECT 1 FROM Records) AND NOT EXISTS(SELECT 1 FROM Sessions) AND NOT EXISTS(SELECT 1 FROM LoginLimits)`;
  const userFields=Object.keys(u),different=userFields.filter(k=>k!=='id').map(k=>`Users.${k} IS NOT excluded.${k}`).join(' OR ');
  return `-- Private admin-only provisioning. Apply after native schema and before NKJV seed.\n-- Contains a credential hash. Do not publish, commit, or print this file.\nPRAGMA foreign_keys=ON;\n`
    +`INSERT INTO Organizations(id,name,slug) VALUES(${quote(o.id)},CASE WHEN ${clean} THEN ${quote(o.name)} ELSE NULL END,${quote(o.slug)}) ON CONFLICT(id) DO UPDATE SET name=NULL WHERE Organizations.name IS NOT excluded.name OR Organizations.slug IS NOT excluded.slug;\n`
    +`INSERT INTO Users(${userFields.join(',')}) VALUES(${Object.values(u).map(quote).join(',')}) ON CONFLICT(id) DO UPDATE SET password_hash=NULL WHERE ${different};\n`;
}

/** Export a selected existing admin and organization only; no archives or session rows. */
export async function exportAdministrator(sourcePath,outputDirectory,selectedAdminId,{newPasswordFile}={}){
  const adminId=guid(selectedAdminId),source=resolve(sourcePath),output=resolve(outputDirectory);
  if(!inside(exportRoot,output))fail('output must be inside the ignored apps/web/test-results/migration directory');
  const before=await fingerprint(source),selected=readAdministrator(source,adminId),after=await fingerprint(source);
  if(JSON.stringify(before)!==JSON.stringify(after))fail('source changed during export; freeze writes and retry');
  const credentialRotated=!!newPasswordFile;
  if(credentialRotated){
    const password=(await readFile(resolve(newPasswordFile),'utf8')).replace(/\r?\n$/,'');
    if(password.length<12||password.length>256||/[\r\n\0]/.test(password))fail('new password must contain 12 to 256 characters on one line');
    const salt=randomBytes(16),derived=pbkdf2Sync(password,salt,100000,32,'sha256');
    selected.user.password_hash=`pbkdf2:${salt.toString('base64')}:${derived.toString('base64')}`;
    selected.user.credential_version=`admin-deployment-${randomUUID()}`;
  }
  const sql=provisioningSql(selected),db=new DatabaseSync(':memory:');
  try{
    db.exec(await readFile(resolve(root,'apps/web/migrations/0001_native.sql'),'utf8'));db.exec(sql);db.exec(sql);
    if(db.prepare('PRAGMA foreign_key_check').all().length)fail('native foreign-key validation failed');
    for(const [table,count]of [['Organizations',1],['Users',1],['Records',0],['Sessions',0],['LoginLimits',0]])
      if(db.prepare(`SELECT count(*) n FROM ${table}`).get().n!==count)fail('native admin-only row counts differ');
    const stored=db.prepare('SELECT * FROM Users').get();
    if(Object.entries(selected.user).some(([key,value])=>stored[key]!==value))fail('native credential or identity roundtrip changed');
  } finally{db.close();}
  const manifest={formatVersion:1,purpose:'fresh-native-admin-only',identity:selected.identity,
    exportedCounts:{organizations:1,users:1,records:0,sessions:0,loginLimits:0},excludedOtherUsers:selected.excludedUsers,
    excludedData:['students','seasons','assignments','solo history','PVP history','content','archives','authentication sessions'],
    cookiesMigrated:false,passwordHashPreserved:!credentialRotated,credentialRotated,verifiedRoundtrip:true,sourceFiles:before,sqlSha256:hash(sql),
    applyOrder:['native schema','admin.sql','built-in NKJV library'],createdAt:new Date().toISOString()};
  await mkdir(exportRoot,{recursive:true});await mkdir(dirname(output),{recursive:true});
  const realRoot=await realpath(exportRoot),realParent=await realpath(dirname(output));
  if(realRoot!==realParent&&!inside(realRoot,realParent))fail('output parent escapes the ignored export directory');
  await mkdir(output,{mode:0o700});
  await writeFile(resolve(output,'admin.sql'),sql,{flag:'wx',mode:0o600});
  await writeFile(resolve(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  return manifest;
}

async function main(){
  const args=process.argv.slice(2);
  if(!args.length||args.includes('--help')){
    console.log('Read-only source export; never writes a database or deploys.\nUsage: node scripts/cloudflare-export-admin.mjs --source <EF SQLite file> --list\n       node scripts/cloudflare-export-admin.mjs --source <EF SQLite file> --admin-id <GUID> --output <ignored apps/web/test-results/migration/subdirectory> [--new-password-file <private text file>]\nUse --new-password-file for hosting whenever the source credential is a development default.');return;
  }
  const options={};
  for(let i=0;i<args.length;i++){
    const key=args[i];if(key==='--list'){options.list=true;continue;}
    if(!['--source','--admin-id','--output','--new-password-file'].includes(key)||!args[i+1]||args[i+1].startsWith('--'))fail('invalid arguments; use --help');
    if(options[key])fail('duplicate argument');options[key]=args[++i];
  }
  if(!options['--source'])fail('provide an explicit source database');
  if(options.list){if(options['--admin-id']||options['--output']||options['--new-password-file'])fail('use either --list or an explicit export');console.log(JSON.stringify(listAdministrators(options['--source']),null,2));return;}
  if(!options['--output'])fail('provide an ignored output directory');
  const manifest=await exportAdministrator(options['--source'],options['--output'],options['--admin-id'],{newPasswordFile:options['--new-password-file']});
  console.log(JSON.stringify({output:resolve(options['--output']),identity:manifest.identity,exportedCounts:manifest.exportedCounts,
    excludedOtherUsers:manifest.excludedOtherUsers,passwordHashPreserved:manifest.passwordHashPreserved,credentialRotated:manifest.credentialRotated,verifiedRoundtrip:true},null,2));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
