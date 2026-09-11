// @vitest-environment node
import { afterEach, beforeEach, expect, it } from "vitest";
import { Response as TestResponse } from "miniflare";
import { createNativeTestApp, TEST_ORG, TEST_USER } from "../test-runtime";
import { budget, ingressBudget } from "./limits";
import type { Env } from "../types";
import { createHmac } from "node:crypto";
import { boundedCleanup } from "./limits";

let app: Awaited<ReturnType<typeof createNativeTestApp>>;
let deliveries: Array<{to:string[];text:string;html:string}>;
let providerStatus: number;
let turnstileResult: Record<string, unknown>;
let hashGate:(()=>Promise<void>)|undefined;
const bindings = {RESEND_API_KEY:"test-only-resend",AUTH_CODE_SECRET:"test-only-secret-with-at-least-32-characters",TURNSTILE_SECRET_KEY:"test-only-turnstile",TURNSTILE_SITE_KEY:"test-only-site",AUTH_EMAIL_FROM:"Erudoza <coach@erudoza.test>"};
beforeEach(async()=>{
  deliveries=[];providerStatus=200;turnstileResult={success:true,hostname:"erudoza.test"};hashGate=undefined;
  app=await createNativeTestApp({bindings,beforePasswordHash:async()=>{await hashGate?.();},outboundService:async request=>{
    if(request.url==="https://challenges.cloudflare.com/turnstile/v0/siteverify") {
      const form=await request.json() as {response:string};
      return TestResponse.json({...turnstileResult,action:turnstileResult.action??form.response});
    }
    if(request.url==="https://api.resend.com/emails") {
      expect(request.headers.get("Idempotency-Key")).toBeTruthy();
      deliveries.push(await request.json() as typeof deliveries[number]);
      return TestResponse.json(providerStatus===200?{id:"delivery"}:{message:"unavailable"},{status:providerStatus});
    }
    throw new Error("Unexpected network request");
  }});
},30_000);
afterEach(async()=>{await app?.runtime.dispose();});
const post=(path:string,data:unknown,cookie?:string)=>app.fetch(`/api/v1${path}`,{method:"POST",headers:{Origin:"https://erudoza.test","Content-Type":"application/json",...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(data)});
const code=()=>deliveries.at(-1)!.text.match(/\b\d{6}\b/)![0];
const requestCode=async(purpose="signup",email="new@example.com")=>{
  const response=await post(`/auth/${purpose}/code`,{email,turnstileToken:purpose==="signup"?"coach_signup":"coach_recovery"});
  expect(response.status).toBe(202);
  return await response.json() as {challengeId:string;expiresAt:string;resendAfterSeconds:number};
};
const complete=(challengeId:string,value=code())=>post("/auth/signup/complete",{challengeId,code:value,displayName:"New Coach",organizationName:"New Club",password:"Testing!567890"});
const ownerCookie=async()=>(await app.login()).headers.get("set-cookie")!.split(";")[0];
const invite=async(cookie:string,email="invitee@example.com")=>{
  const response=await post(`/organizations/${TEST_ORG}/coach-invitations`,{email},cookie);
  expect(response.status).toBe(201);
  const invitation=await response.json() as {id:string;status:string};
  const token=deliveries.at(-1)!.text.match(/#([^\s]+)/)![1];
  return {...invitation,token};
};
const inviteCode=async(token:string,email="invitee@example.com")=>{
  // Simulate the minute elapsed while opening the delivered invitation.
  await app.db.prepare("UPDATE AuthBudgets SET expires_at=0 WHERE key LIKE 'email-cooldown:%'").run();
  const response=await post("/auth/invitation/code",{token,email,turnstileToken:"coach_invitation"});
  expect(response.status).toBe(202);
  return await response.json() as {challengeId:string};
};
const accept=(challengeId:string,value=code())=>post("/auth/invitation/complete",{challengeId,code:value,displayName:"Invited Coach",password:"Testing!567890"});

it("creates one verified Adult Owner and a secure session, never trusting submitted roles",async()=>{
  expect(await (await app.fetch("/api/v1/auth/coach-options")).json()).toEqual({available:true,turnstileSiteKey:"test-only-site"});
  const receipt=await requestCode();
  expect(receipt.resendAfterSeconds).toBe(60);
  const response=await post("/auth/signup/complete",{challengeId:receipt.challengeId,code:code(),displayName:"New Coach",organizationName:"New Club",password:"Testing!567890",role:"Student",organizationId:TEST_ORG});
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({kind:"Adult",role:"Owner",organizationName:"New Club",email:"new@example.com"});
  expect(response.headers.get("set-cookie")).toContain("HttpOnly; Secure; SameSite=Lax");
  expect((await complete(receipt.challengeId)).status).toBe(400);
  expect((await app.db.prepare("SELECT COUNT(*) AS count FROM Organizations").first<{count:number}>())!.count).toBe(2);
});
it("limits a code to five guesses and rejects expiry without partial provisioning",async()=>{
  const receipt=await requestCode();const actual=code();
  for(let i=0;i<5;i++) expect((await complete(receipt.challengeId,actual==="000000"?"999999":"000000")).status).toBe(400);
  expect((await complete(receipt.challengeId,actual)).status).toBe(400);
  expect((await app.db.prepare("SELECT COUNT(*) AS count FROM Users").first<{count:number}>())!.count).toBe(1);
  const second=await requestCode("signup","expired@example.com");
  await app.db.prepare("UPDATE AuthChallenges SET expires_at=0 WHERE id=?").bind(second.challengeId).run();
  expect((await complete(second.challengeId)).status).toBe(400);
});
it("concurrent redemptions create at most one organization/user/session",async()=>{
  const receipt=await requestCode();const actual=code();
  const responses=await Promise.all([complete(receipt.challengeId,actual),complete(receipt.challengeId,actual)]);
  expect(responses.map(r=>r.status).sort()).toEqual([200,400]);
  expect((await app.db.prepare("SELECT COUNT(*) AS count FROM Organizations").first<{count:number}>())!.count).toBe(2);
  expect((await app.db.prepare("SELECT COUNT(*) AS count FROM Sessions").first<{count:number}>())!.count).toBe(1);
});
it("sends generic receipts for existing and unknown identities without takeover",async()=>{
  await app.db.prepare("UPDATE Users SET email='existing@example.com' WHERE id=?").bind(TEST_USER).run();
  const receipt=await requestCode("signup","existing@example.com");
  expect((await complete(receipt.challengeId)).status).toBe(400);
  const unknown=await requestCode("password","unknown@example.com");
  expect((await post("/auth/password/complete",{challengeId:unknown.challengeId,code:code(),password:"Testing!567890"})).status).toBe(400);
  expect((await app.login()).status).toBe(200);
});
it("recovery changes adult credentials and revokes all prior sessions atomically",async()=>{
  await app.db.prepare("UPDATE Users SET email='coach@example.com' WHERE id=?").bind(TEST_USER).run();
  const cookie=await ownerCookie();
  const receipt=await requestCode("password","coach@example.com");const actual=code();
  expect((await post("/auth/password/complete",{challengeId:receipt.challengeId,code:actual,password:"Changed!567890"})).status).toBe(204);
  expect((await app.fetch("/api/v1/me",{headers:{Cookie:cookie}})).status).toBe(401);
  expect((await app.login()).status).toBe(401);
  expect((await post("/auth/login",{identifier:"coach@example.com",password:"Changed!567890"})).status).toBe(200);
  expect((await post("/auth/password/complete",{challengeId:receipt.challengeId,code:actual,password:"Another!567890"})).status).toBe(400);
});
it("issues an invitation, requires its email code, and creates only a same-club Admin",async()=>{
  const cookie=await ownerCookie();const invitation=await invite(cookie);
  const details=await post("/auth/invitation/details",{token:invitation.token});
  expect(await details.json()).toMatchObject({organizationName:"Practice Club",emailHint:expect.any(String)});
  const receipt=await inviteCode(invitation.token);
  const response=await accept(receipt.challengeId);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({kind:"Adult",role:"Admin",organizationId:TEST_ORG});
  const list=await app.fetch(`/api/v1/organizations/${TEST_ORG}/coach-invitations`,{headers:{Cookie:cookie}});
  expect(await list.json()).toEqual([expect.objectContaining({id:invitation.id,status:"accepted"})]);
  const coaches=await app.fetch(`/api/v1/organizations/${TEST_ORG}/coaches`,{headers:{Cookie:cookie}});
  expect(await coaches.json()).toHaveLength(2);
});
it("resend rotates secrets and revocation invalidates already requested codes",async()=>{
  const cookie=await ownerCookie();const invitation=await invite(cookie);const first=await inviteCode(invitation.token);const firstCode=code();
  await app.db.prepare("DELETE FROM AuthBudgets WHERE key LIKE 'email-cooldown:%'").run();
  expect((await post(`/organizations/${TEST_ORG}/coach-invitations/${invitation.id}/resend`,{},cookie)).status).toBe(200);
  expect((await post("/auth/invitation/details",{token:invitation.token})).status).toBe(400);
  expect((await accept(first.challengeId,firstCode)).status).toBe(400);
  const rotated=deliveries.at(-1)!.text.match(/#([^\s]+)/)![1];
  const second=await inviteCode(rotated);const secondCode=code();
  expect((await app.fetch(`/api/v1/organizations/${TEST_ORG}/coach-invitations/${invitation.id}`,{method:"DELETE",headers:{Origin:"https://erudoza.test",Cookie:cookie}})).status).toBe(204);
  expect((await accept(second.challengeId,secondCode)).status).toBe(400);
});
it("acceptance rechecks inviter authorization and never moves/reactivates an existing account",async()=>{
  const cookie=await ownerCookie();const invitation=await invite(cookie);const receipt=await inviteCode(invitation.token);const actual=code();
  await app.db.prepare("UPDATE Users SET active=0 WHERE id=?").bind(TEST_USER).run();
  expect((await accept(receipt.challengeId,actual)).status).toBe(400);
  await app.db.prepare("UPDATE Users SET active=1,email='existing@example.com' WHERE id=?").bind(TEST_USER).run();
  const existing=await invite(cookie,"existing@example.com");const challenge=await inviteCode(existing.token,"existing@example.com");
  expect((await accept(challenge.challengeId)).status).toBe(400);
  expect((await app.login()).status).toBe(200);
});
it("rejects student/cross-club invitation management and malformed inputs",async()=>{
  const cookie=await ownerCookie();
  expect((await post("/organizations/22222222-2222-4222-8222-222222222222/coach-invitations",{email:"x@example.com"},cookie)).status).toBe(403);
  await app.db.prepare("UPDATE Users SET kind='Student',role='Student' WHERE id=?").bind(TEST_USER).run();
  expect((await post(`/organizations/${TEST_ORG}/coach-invitations`,{email:"x@example.com"},cookie)).status).toBe(403);
  for(const input of [null,[],{}, {email:"bad",turnstileToken:"coach_signup"}]) expect((await post("/auth/signup/code",input)).status).toBe(400);
});
it("checks Turnstile hostname/action and fails closed on rejected providers",async()=>{
  turnstileResult={success:true,hostname:"evil.test"};
  expect((await post("/auth/signup/code",{email:"new@example.com",turnstileToken:"coach_signup"})).status).toBe(400);
  turnstileResult={success:true,hostname:"erudoza.test",action:"coach_recovery"};
  expect((await post("/auth/signup/code",{email:"new@example.com",turnstileToken:"coach_signup"})).status).toBe(400);
  turnstileResult={success:true,hostname:"erudoza.test"};providerStatus=503;
  expect((await post("/auth/signup/code",{email:"new@example.com",turnstileToken:"coach_signup"})).status).toBe(503);
  const challenge=await app.db.prepare("SELECT id FROM AuthChallenges LIMIT 1").first<{id:string}>();
  expect((await complete(challenge!.id)).status).toBe(400);
});
it("enforces email cooldown and atomic global delivery budgets",async()=>{
  await requestCode();
  expect((await post("/auth/signup/code",{email:"new@example.com",turnstileToken:"coach_signup"})).status).toBe(429);
  await app.db.prepare("UPDATE AuthBudgets SET attempts=79 WHERE key='delivery:day'").run();
  const responses=await Promise.all([post("/auth/signup/code",{email:"one@example.com",turnstileToken:"coach_signup"}),post("/auth/signup/code",{email:"two@example.com",turnstileToken:"coach_signup"})]);
  expect(responses.map(r=>r.status).sort()).toEqual([202,429]);
  expect(deliveries).toHaveLength(2);
});
it("does not advertise or accept onboarding without all provider configuration",async()=>{
  const unavailable=await createNativeTestApp();
  try {
    expect(await (await unavailable.fetch("/api/v1/auth/coach-options")).json()).toEqual({available:false,turnstileSiteKey:null});
    expect((await unavailable.fetch("/api/v1/auth/signup/code",{method:"POST",headers:{Origin:"https://erudoza.test"},body:JSON.stringify({email:"new@example.com",turnstileToken:"anything"})})).status).toBe(503);
  } finally {await unavailable.runtime.dispose();}
});
it("does not let a delayed request move a budget backwards across a window boundary",async()=>{
  await budget({DB:app.db} as unknown as Env,"boundary",100,1,Date.now()+60000);
  await expect(budget({DB:app.db} as unknown as Env,"boundary",99,1,Date.now()+60000)).rejects.toMatchObject({status:429});
  const evidence=await app.db.prepare("SELECT window,attempts FROM AuthBudgets WHERE key='boundary'").first();
  expect(evidence).toEqual({window:100,attempts:1});
});
it("stores purpose-bound HMAC evidence and invalidates an older requested code",async()=>{
  const first=await requestCode();const oldCode=code();
  const evidence=await app.db.prepare("SELECT code_digest FROM AuthChallenges WHERE id=?").bind(first.challengeId).first<{code_digest:string}>();
  expect(evidence!.code_digest).toBe(createHmac("sha256",bindings.AUTH_CODE_SECRET).update(JSON.stringify([first.challengeId,"signup","new@example.com",oldCode])).digest("base64"));
  await app.db.prepare("UPDATE AuthBudgets SET expires_at=0 WHERE key LIKE 'email-cooldown:%'").run();
  const second=await requestCode();const newCode=code();
  expect((await complete(first.challengeId,oldCode)).status).toBe(400);
  expect((await complete(second.challengeId,newCode)).status).toBe(200);
});
it("keeps all account writes rolled back when a session insert fails",async()=>{
  const receipt=await requestCode();const actual=code();
  await app.db.prepare("CREATE TRIGGER fail_test_session BEFORE INSERT ON Sessions BEGIN SELECT RAISE(ABORT, 'injected session failure'); END").run();
  expect((await complete(receipt.challengeId,actual)).status).toBe(503);
  expect(await app.db.prepare("SELECT COUNT(*) AS count FROM Organizations").first()).toEqual({count:1});
  expect(await app.db.prepare("SELECT COUNT(*) AS count FROM Users").first()).toEqual({count:1});
  expect(await app.db.prepare("SELECT COUNT(*) AS count FROM Sessions").first()).toEqual({count:0});
  expect(await app.db.prepare("SELECT consumed_at,claim_nonce FROM AuthChallenges WHERE id=?").bind(receipt.challengeId).first()).toEqual({consumed_at:null,claim_nonce:null});
});
it("rechecks invitation revocation after password work has started",async()=>{
  const cookie=await ownerCookie();const invitation=await invite(cookie);const receipt=await inviteCode(invitation.token);const actual=code();
  let release!:()=>void,entered!:()=>void;
  const waiting=new Promise<void>(resolve=>{entered=resolve;});
  hashGate=()=>{entered();return new Promise<void>(resolve=>{release=resolve;});};
  const response=accept(receipt.challengeId,actual);await waiting;
  try {
    expect((await app.fetch(`/api/v1/organizations/${TEST_ORG}/coach-invitations/${invitation.id}`,{method:"DELETE",headers:{Origin:"https://erudoza.test",Cookie:cookie}})).status).toBe(204);
  } finally {release();}
  expect((await response).status).toBe(400);
  expect(await app.db.prepare("SELECT COUNT(*) AS count FROM Users").first()).toEqual({count:1});
});
it("rechecks inviter role changes after password work has started",async()=>{
  const cookie=await ownerCookie();const invitation=await invite(cookie);const receipt=await inviteCode(invitation.token);const actual=code();
  let release!:()=>void,entered!:()=>void;
  const waiting=new Promise<void>(resolve=>{entered=resolve;});
  hashGate=()=>{entered();return new Promise<void>(resolve=>{release=resolve;});};
  const response=accept(receipt.challengeId,actual);await waiting;
  try {await app.db.prepare("UPDATE Users SET role='Student' WHERE id=?").bind(TEST_USER).run();} finally {release();}
  expect((await response).status).toBe(400);
  expect(await app.db.prepare("SELECT COUNT(*) AS count FROM Users").first()).toEqual({count:1});
});
it("rechecks duplicate identities inserted while signup password work waits",async()=>{
  const receipt=await requestCode();const actual=code();
  let release!:()=>void,entered!:()=>void;
  const waiting=new Promise<void>(resolve=>{entered=resolve;});
  hashGate=()=>{entered();return new Promise<void>(resolve=>{release=resolve;});};
  const response=complete(receipt.challengeId,actual);await waiting;
  try {await app.db.prepare("UPDATE Users SET email='new@example.com' WHERE id=?").bind(TEST_USER).run();} finally {release();}
  expect((await response).status).toBe(400);
  expect(await app.db.prepare("SELECT COUNT(*) AS count FROM Organizations").first()).toEqual({count:1});
});
it("permits only one of two competing fifth guesses",async()=>{
  const receipt=await requestCode();const actual=code();
  await app.db.prepare("UPDATE AuthChallenges SET attempts=4 WHERE id=?").bind(receipt.challengeId).run();
  const responses=await Promise.all([complete(receipt.challengeId,actual),complete(receipt.challengeId,actual)]);
  expect(responses.map(r=>r.status).sort()).toEqual([200,400]);
  expect(await app.db.prepare("SELECT attempts FROM AuthChallenges WHERE id=?").bind(receipt.challengeId).first()).toEqual({attempts:5});
});
it("atomically caps new organizations at ten per day",async()=>{
  const first=await requestCode("signup","first@example.com");const firstCode=code();
  const second=await requestCode("signup","second@example.com");const secondCode=code();
  await budget({DB:app.db} as unknown as Env,"organizations:day",Math.floor(Date.now()/86400_000),10,Date.now()+86400_000);
  await app.db.prepare("UPDATE AuthBudgets SET attempts=9 WHERE key='organizations:day'").run();
  const results=await Promise.all([complete(first.challengeId,firstCode),complete(second.challengeId,secondCode)]);
  expect(results.map(r=>r.status).sort()).toEqual([200,429]);
  expect(await app.db.prepare("SELECT COUNT(*) AS count FROM Organizations").first()).toEqual({count:2});
});
it("atomically caps pending invitations at ten",async()=>{
  const cookie=await ownerCookie();const original=await invite(cookie);
  for(let n=1;n<9;n++) await app.db.prepare("INSERT INTO CoachInvitations(id,org_id,email,inviter_id,token_hash,version,status,delivered,created_at,expires_at) SELECT ?,org_id,?,inviter_id,?,?,'pending',1,created_at,expires_at FROM CoachInvitations WHERE id=?").bind(crypto.randomUUID(),`pending${n}@example.com`,`hash${n}`,crypto.randomUUID(),original.id).run();
  const results=await Promise.all([post(`/organizations/${TEST_ORG}/coach-invitations`,{email:"tenth@example.com"},cookie),post(`/organizations/${TEST_ORG}/coach-invitations`,{email:"eleventh@example.com"},cookie)]);
  expect(results.map(r=>r.status).sort()).toEqual([201,409]);
  expect(await app.db.prepare("SELECT COUNT(*) AS count FROM CoachInvitations WHERE status='pending'").first()).toEqual({count:10});
});
it("caps adult coaches at twenty at the final invitation claim",async()=>{
  const cookie=await ownerCookie();const invitation=await invite(cookie);const receipt=await inviteCode(invitation.token);const actual=code();
  for(let n=1;n<20;n++) await app.db.prepare("INSERT INTO Users(id,org_id,user_name,display_name,kind,role,password_hash,credential_version) SELECT ?,org_id,?,display_name,'Adult','Admin',password_hash,credential_version FROM Users WHERE id=?").bind(crypto.randomUUID(),`coach-${n}`,TEST_USER).run();
  expect((await accept(receipt.challengeId,actual)).status).toBe(400);
  expect(await app.db.prepare("SELECT COUNT(*) AS count FROM Users").first()).toEqual({count:20});
});
it("rejects student recovery and old recovery codes after another credential change",async()=>{
  await app.db.prepare("UPDATE Users SET email='student@example.com',kind='Student',role='Student' WHERE id=?").bind(TEST_USER).run();
  const student=await requestCode("password","student@example.com");
  expect((await post("/auth/password/complete",{challengeId:student.challengeId,code:code(),password:"Changed!567890"})).status).toBe(400);
  await app.db.prepare("UPDATE Users SET email='coach@example.com',kind='Adult',role='Owner' WHERE id=?").bind(TEST_USER).run();
  const adult=await requestCode("password","coach@example.com");const actual=code();
  await app.db.prepare("UPDATE Users SET credential_version='changed-elsewhere' WHERE id=?").bind(TEST_USER).run();
  expect((await post("/auth/password/complete",{challengeId:adult.challengeId,code:actual,password:"Changed!567890"})).status).toBe(400);
});
it("applies invitation actor budgets to acceptance-code emails too",async()=>{
  const cookie=await ownerCookie();const invitation=await invite(cookie);
  await app.db.prepare("UPDATE AuthBudgets SET attempts=6 WHERE key=?").bind(`delivery:actor:${TEST_USER}`).run();
  await app.db.prepare("UPDATE AuthBudgets SET expires_at=0 WHERE key LIKE 'email-cooldown:%'").run();
  expect((await post("/auth/invitation/code",{token:invitation.token,email:"invitee@example.com",turnstileToken:"coach_invitation"})).status).toBe(429);
  expect(deliveries).toHaveLength(1);
});
it("bounds expired cleanup and rejects global ingress without new identity rows",async()=>{
  const env={DB:app.db} as unknown as Env;
  await app.db.batch(Array.from({length:75},(_,i)=>app.db.prepare("INSERT INTO AuthBudgets VALUES(?,0,1,0)").bind(`expired-${i}`)));
  await boundedCleanup(env);
  expect(await app.db.prepare("SELECT COUNT(*) AS count FROM AuthBudgets").first()).toEqual({count:25});
  await budget(env,"ingress:login:day",Math.floor(Date.now()/86400_000),1200,Date.now()+86400_000);
  await app.db.prepare("UPDATE AuthBudgets SET attempts=1200 WHERE key='ingress:login:day'").run();
  const before=await app.db.prepare("SELECT COUNT(*) AS count FROM AuthBudgets").first();
  expect((await post("/auth/login",{identifier:"random@example.com",password:"anything"})).status).toBe(429);
  expect(await app.db.prepare("SELECT COUNT(*) AS count FROM AuthBudgets").first()).toEqual(before);
  expect(await app.db.prepare("SELECT COUNT(*) AS count FROM LoginLimits").first()).toEqual({count:0});
});
it("repeated rejected IP attempts do not consume global reservations",async()=>{
  const env={DB:app.db} as unknown as Env,request=new Request("https://erudoza.test/api/v1/auth/signup/code");
  await ingressBudget(request,env,"code");
  await app.db.prepare("UPDATE AuthBudgets SET attempts=120 WHERE key LIKE 'ingress:%:ip:%'").run();
  const before=await app.db.prepare("SELECT key,attempts FROM AuthBudgets WHERE key LIKE 'ingress:%' AND key NOT LIKE '%:ip:%' ORDER BY key").all();
  await expect(ingressBudget(request,env,"code")).rejects.toMatchObject({status:429});
  const after=await app.db.prepare("SELECT key,attempts FROM AuthBudgets WHERE key LIKE 'ingress:%' AND key NOT LIKE '%:ip:%' ORDER BY key").all();
  expect(after.results).toEqual(before.results);
});
it("reserves login and invitation revocation capacity independently of public onboarding",async()=>{
  const env={DB:app.db} as unknown as Env;
  await ingressBudget(new Request("https://erudoza.test/api/v1/auth/signup/code"),env,"code");
  await app.db.prepare("UPDATE AuthBudgets SET attempts=2400 WHERE key LIKE 'ingress:%' AND key NOT LIKE '%:ip:%'").run();
  const response=await app.login();expect(response.status).toBe(200);
  const cookie=response.headers.get("set-cookie")!.split(";")[0];
  const invitation=await invite(cookie);
  expect((await app.fetch(`/api/v1/organizations/${TEST_ORG}/coach-invitations/${invitation.id}`,{method:"DELETE",headers:{Origin:"https://erudoza.test",Cookie:cookie}})).status).toBe(204);
});
