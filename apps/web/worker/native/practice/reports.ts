import { prepareTeamHonors } from '../mastery/store';
import {DurableObject} from "cloudflare:workers";
import type {Env} from "../types";
import {json} from "../types";
import {Store} from "../store";
import type {Room} from "./state";
import {calculateAwards} from "./awards";
export {calculateAwards,trends} from "./awards";
export type {Award} from "./awards";
/** One projection authority per organization/season prevents cross-room award races. */
export class PracticeReports extends DurableObject<Env>{
 private tail:Promise<void>=Promise.resolve();
 async fetch(request:Request):Promise<Response>{
  const r=await request.json() as Room;const previous=this.tail;let release!:()=>void;this.tail=new Promise<void>(resolve=>release=resolve);await previous;
  try{const store=new Store(this.env.DB),old=await store.get<Room>("match",r.id,r.orgId);if(old&&old.revision>=r.revision)return json({projected:true});
   const all=(await store.list<Room>("match",r.orgId,{seasonId:r.seasonId})).filter(x=>x.id!==r.id);all.push(r);const awards=calculateAwards(all);
   const statements=[this.env.DB.prepare("INSERT INTO Records(kind,id,org_id,season_id,data,revision) VALUES('match',?,?,?,?,?) ON CONFLICT(kind,id,org_id) DO UPDATE SET data=excluded.data,revision=excluded.revision").bind(r.id,r.orgId,r.seasonId,JSON.stringify(r),r.revision),this.env.DB.prepare("DELETE FROM Records WHERE kind='award' AND org_id=? AND season_id=?").bind(r.orgId,r.seasonId)];
   // Bulk insertion remains two writes plus one statement, independent of roster count.
   statements.push(this.env.DB.prepare("INSERT INTO Records(kind,id,org_id,season_id,owner_id,data) SELECT 'award',json_extract(value,'$.key')||':'||json_extract(value,'$.userId')||':'||?, ?, ?,json_extract(value,'$.userId'),value FROM json_each(?)").bind(r.seasonId,r.orgId,r.seasonId,JSON.stringify(awards)));
   statements.push(...prepareTeamHonors(store,r.orgId,all,r));
   await this.env.DB.batch(statements);return json({projected:true});
  }finally{release();}
 }
}
