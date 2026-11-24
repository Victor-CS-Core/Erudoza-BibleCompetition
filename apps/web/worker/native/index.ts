import { handleProfile } from './mastery/profile';
import { disputeRoutes } from './pbe/disputes';
import { handleTraining } from './training/routes';
import type { Env } from "./types";
import { HttpError, json } from "./types";
import { authenticate, checkOrigin, handleAuth, me } from "./auth";
import { Store } from "./store";
import { handleApplication } from "./application";
import { handlePractice } from "./practice/routes";
import { handleStudy } from "./study/routes";
import { handleScripture } from "./study/scripture";
import { handleOnboarding } from "./onboarding/routes";
import { handleCoachManagement } from "./onboarding/invitations";
import { runScheduledWatch } from "./application/pbe-materials";
import { runTeamPracticeScan } from "./practice/events";
import { runRetentionPurge } from "./retention";
import { enforcePerimeter } from "./perimeter";
import { handleControlCenter, handleSupportIngest, runMasterDigest } from "./control-center";
import { recordErrorEvent } from "./error-events";
import { APP_VERSION } from "./version";
export { PracticeRoom } from "./practice/room";
export { PracticeReports } from "./practice/reports";
export { PbeSoloRound } from "./pbe/solo-round";
export { PasswordCrypto } from "./password-crypto";
export default {
  async fetch(request:Request,env:Env):Promise<Response> {
    try {
      const url=new URL(request.url);
      if(!url.pathname.startsWith("/api/")) return env.ASSETS ? await env.ASSETS.fetch(request) as unknown as Response : new Response("Not found",{status:404});
      await enforcePerimeter(request,env);
      checkOrigin(request,env);
      const solo=url.pathname.match(/^\/api\/v1\/study\/sessions\/([a-f0-9-]{36})\/timed$/i);
      if(solo&&["GET","POST"].includes(request.method)){
        if(!env.PBE_SOLO)throw new HttpError(503,"Timed rehearsal storage is not configured.");
        return await env.PBE_SOLO.getByName(solo[1].toLowerCase()).fetch(request as never) as unknown as Response;
      }
      // Forward body untouched. The authoritative room captures ingress before authentication.
      const live=url.pathname.match(/^\/api\/v1\/organizations\/([a-f0-9-]{36})\/practice\/rooms\/([a-f0-9-]{36})(?:\/(?:commands|socket))?$/i);
      if(live&&["GET","POST"].includes(request.method)){
        if(!env.ROOMS)throw new HttpError(503,"Room storage is not configured.");
        if(request.method==="POST"&&!url.pathname.endsWith("/commands"))throw new HttpError(404,"Route not found.");
        return await env.ROOMS.getByName(`${live[1].toLowerCase()}:${live[2].toLowerCase()}`).fetch(request as never) as unknown as Response;
      }
      if(url.pathname==="/api/v1/health"&&request.method==="GET") { await env.DB.prepare("SELECT 1").first(); return json({status:"ok",database:true,runtime:"cloudflare",timing:"server-event-time-v1",version:APP_VERSION}); }
      // Support ingest is token-guarded, not session-guarded: the caller is
      // the mail triage flow, and the endpoint 404s until its secret is set.
      const ingest=await handleSupportIngest(request,env); if(ingest) return ingest;
      const auth=await handleAuth(request,env); if(auth) return auth;
      const onboarding=await handleOnboarding(request,env); if(onboarding) return onboarding;
      const actor=await authenticate(request,env);
      if(url.pathname==="/api/v1/me"&&request.method==="GET") return json(me(actor));
      // Admin Control Center: app-wide and master-admin gated inside the
      // handler — deliberately before the organization match below, because
      // none of its reads are scoped to the caller's club.
      if(url.pathname.startsWith("/api/v1/admin/control-center")){const cc=await handleControlCenter({request,env,actor,orgId:actor.organizationId,path:url.pathname,store:new Store(env.DB)});if(cc)return cc;}
      if(url.pathname.startsWith('/api/v1/pbe/disputes')){const dispute=await disputeRoutes({request,env,actor,orgId:actor.organizationId,path:url.pathname,store:new Store(env.DB)});if(dispute)return dispute;}
      if(url.pathname.startsWith("/api/v1/profile/")){const profile=await handleProfile({request,env,actor,orgId:actor.organizationId,path:url.pathname,store:new Store(env.DB)});if(profile)return profile;}
      if(url.pathname.startsWith("/api/v1/study/")||url.pathname.startsWith("/api/v1/progress/")){
        const training=await handleTraining({request,env,actor,orgId:actor.organizationId,path:url.pathname,store:new Store(env.DB)});if(training)return training;
        const scripture=await handleScripture({request,env,actor,orgId:actor.organizationId,path:url.pathname,store:new Store(env.DB)});if(scripture)return scripture;
        const study=await handleStudy({request,env,actor,orgId:actor.organizationId,path:url.pathname,store:new Store(env.DB)});if(study)return study;
      }
      const match=url.pathname.match(/^\/api\/v1\/organizations\/([a-f0-9-]{36})(\/.*)?$/i);
      if(!match) throw new HttpError(404,"Route not found.");
      const orgId=match[1].toLowerCase(); if(orgId!==actor.organizationId) throw new HttpError(403,"Organization access denied.");
      if(!match[2]&&request.method==="GET") return json(await env.DB.prepare("SELECT id,name,slug FROM Organizations WHERE id=?").bind(orgId).first());
      const context={request,env,actor,orgId,path:match[2]??"",store:new Store(env.DB)};
      const coaches=await handleCoachManagement(context);if(coaches)return coaches;
      const practice=await handlePractice(context);if(practice)return practice;
      const study=await handleStudy(context);if(study)return study;
      const application=await handleApplication(context);if(application)return application;
      throw new HttpError(404,"Route not found.");
    } catch(error) {
      // Server errors land in the durable ErrorEvents log so the control
      // center's System panel can show them; recording is best-effort and
      // never changes the response. Client errors (4xx) are not recorded.
      let pathname = ""; try { pathname = new URL(request.url).pathname; } catch { /* keep the response path simple */ }
      if(error instanceof HttpError) { if(error.status>=500) await recordErrorEvent(env,pathname,error.status,"HttpError"); return json({title:error.message,detail:error.message},error.status); }
      console.error("Native API operation failed",error instanceof Error?error.name:"UnknownError");
      await recordErrorEvent(env,pathname,503,error instanceof Error?error.name:"UnknownError");
      return json({title:"Service unavailable",detail:"The operation could not be completed. Please retry."},503);
    }
  },
  // Cloudflare cron trigger: weekly NAD PBE materials watch. Drafts only —
  // the master admin reviews everything in /admin/materials. Runs as the
  // first-party system identity, so no HTTP auth is involved.
  async scheduled(_event: unknown, env: Env): Promise<void> {
    try {
      const result = await runScheduledWatch(env);
      console.log(`NAD watcher scheduled run: checked ${result.mediaChecked} media items, drafted ${result.drafted.length} proposals + ${result.newsDrafted.length} news articles.`);
    } catch (error) {
      console.error("NAD watcher scheduled run failed", error instanceof Error ? error.message : "UnknownError");
    }
    // Team Practice events: open scheduled events whose start time arrived
    // and expire event lobbies that never started within 24 hours.
    try {
      const scanned = await runTeamPracticeScan(env);
      if (scanned.opened || scanned.expired) console.log(`Team practice scan: opened ${scanned.opened} scheduled events, expired ${scanned.expired} stale lobbies.`);
    } catch (error) {
      console.error("Team practice scan failed", error instanceof Error ? error.message : "UnknownError");
    }
    // Weekly Records retention: purge audit rows older than 90 days and cap
    // notifications per user. Independent of the watcher so one failure
    // never suppresses the other.
    try {
      const purged = await runRetentionPurge(env);
      console.log(`Retention purge scheduled run: deleted ${purged.audit} audit rows and ${purged.notifications} notification rows.`);
    } catch (error) {
      console.error("Retention purge scheduled run failed", error instanceof Error ? error.message : "UnknownError");
    }
    // Master-admin Monday digest: compose the week that just ended, store it
    // for the control center, and email it via the existing Resend path when
    // configured. Independent of the jobs above, like they are of each other.
    try {
      const digest = await runMasterDigest(env);
      console.log(`Master digest composed for week of ${digest.weekStart}: ${digest.newUsers} new users, ${digest.sessions} sessions, ${digest.openTickets} open tickets.`);
    } catch (error) {
      console.error("Master digest scheduled run failed", error instanceof Error ? error.message : "UnknownError");
    }
  }
};
