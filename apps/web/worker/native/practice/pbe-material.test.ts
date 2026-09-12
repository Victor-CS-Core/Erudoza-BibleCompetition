// @vitest-environment node
import {expect,it} from 'vitest';
import {selectRoomQuestions,eligibleRoomReserves} from './pbe-material';
import type {PbeQuestion} from '../pbe/types';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const question=(n:number):PbeQuestion=>({schemaVersion:2,id:id(n),version:1,contentPackId:id(1000),sourceUnitId:id(1001),sourceUnitIds:[id(1001)],sourceKind:'Scripture',kind:'ShortAnswer',prompt:'Who?',reference:'Test 1:1',evidence:'Alpha',ordered:false,parts:[{targetId:id(1002),acceptedAnswers:['Alpha'],points:1}]});
it('selects maximum participant question exposure first without target-count interference and reserves distinct IDs',()=>{
 const bank=Array.from({length:22},(_,n)=>question(n+1));const history=new Map(bank.slice(0,11).map(q=>[q.id,3]));
 const result=selectRoomQuestions(bank,history,id(3000),10);
 expect(result.slice(0,10).every(q=>!history.has(q.id))).toBe(true);expect(result).toHaveLength(11);expect(new Set(result.map(q=>q.id)).size).toBe(result.length);
});
it('applies final ten-question quotas before selecting compatible reserves and reports short banks',()=>{
 const bank=Array.from({length:11},(_,n)=>question(n+1));bank[0].sourceKind='Commentary';bank[1].sourceKind='Commentary';
 expect(()=>selectRoomQuestions(bank,new Map(),id(3000),10)).toThrow(/10.*9/);
 const ten=Array.from({length:10},(_,n)=>question(n+1));expect(()=>selectRoomQuestions(ten,new Map(),id(3000),10)).toThrow(/reserve/);
});

it('treats a changed reserve evidence proof as unavailable without blocking selected material',async()=>{
 const reserve=question(90);const room={reserves:[reserve],sourceProofs:{[reserve.id]:'prior-proof'}} as unknown as import('./state').Room;
 const sources=new Map(reserve.sourceUnitIds.map(id=>[id,{id,canonicalText:'Changed source',citation:reserve.reference}]));
 expect([...(await eligibleRoomReserves(room,sources))]).toEqual([]);
});
