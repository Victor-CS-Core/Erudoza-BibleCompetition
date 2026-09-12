// @vitest-environment node
import {expect,it} from 'vitest';
import {readRoomHistory,summarizeRoom} from './room-history';
import {RoomCodec,ROOM_STORAGE_FORMAT} from './room-storage';
import {makeRoom} from './state';
import type {Actor,Env} from '../types';

it('reads only the referenced history closure in bounded sets instead of a D1 statement for every component',async()=>{
 const r=makeRoom('room',{userId:'student',organizationId:'org',displayName:'Student'} as Actor,{format:'Pbe',seasonId:'season',questionCount:90,teamSize:6,teamCount:2},'epoch',1000);
 r.questions=Array.from({length:90},(_,n)=>({id:`q${n}`,version:1,sourceUnitId:'source',parts:[{points:1,acceptedAnswers:[n===89?'a'.repeat(300000):'answer']}]})) as typeof r.questions;
 r.status='Completed';const {manifest,nodes}=await new RoomCodec().encode(r),envelope={format:ROOM_STORAGE_FORMAT,manifest,summary:summarizeRoom(r)};
 let statements=0;
 const db={prepare:(sql:string)=>({bind:(...args:unknown[])=>({first:async()=>{statements++;if(sql.includes('FROM Records'))return {data:JSON.stringify(envelope),revision:r.revision,season_id:r.seasonId};return nodes.has(String(args[3]))?{data:nodes.get(String(args[3]))}:null;},all:async()=>{statements++;expect(sql).toContain('json_each');expect(args.slice(0,3)).toEqual(['org','season','room']);return {results:(JSON.parse(String(args[3])) as string[]).filter(h=>nodes.has(h)).map(hash=>({hash,data:nodes.get(hash)}))};}})})} as unknown as Env['DB'];
 expect((await readRoomHistory(db,'org','room'))!.value).toEqual(r);expect(statements).toBeLessThanOrEqual(12);
 envelope.format='erudoza.practice-room/2';await expect(readRoomHistory(db,'org','room')).rejects.toThrow(/format/);envelope.format=ROOM_STORAGE_FORMAT;
 const wrong=structuredClone(manifest);wrong.questions[0].id='wrong-question';await expect(new RoomCodec().decode(wrong,h=>nodes.get(h)??null)).rejects.toThrow(/missing or corrupt/);
 const wrongScope=structuredClone(manifest);wrongScope.orgId='other-org';await expect(new RoomCodec().decode(wrongScope,h=>nodes.get(h)??null)).rejects.toThrow(/missing or corrupt/);
 nodes.delete(manifest.questions[0].hash);await expect(readRoomHistory(db,'org','room')).rejects.toThrow(/missing or corrupt/);
});
