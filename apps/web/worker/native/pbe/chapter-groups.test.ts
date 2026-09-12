// @vitest-environment node
import {expect,it} from 'vitest';
import {chapterGroups} from './chapter-groups';
import type {PbeSource} from './sources';
const source=(verse:number):PbeSource=>({id:`v${verse}`,contentPackId:'pack',bookKey:'GEN',chapter:1,verse,ordinal:verse,citation:`GEN1:${verse}`,canonicalText:'text',sourceKind:'Scripture'});
it.each([[1,[1]],[2,[2]],[6,[3,3]],[11,[4,4,3]]])('balances %s assigned verses into stable children',(n,lengths)=>{
 const rows=chapterGroups(Array.from({length:n as number},(_,i)=>source(i+1)),new Map());
 expect(rows[0].key).toBe('chapter:pack:GEN:1');expect(rows.filter(r=>r.kind==='PassageGroup').map(r=>r.sourceUnitIds.length)).toEqual(lengths);
});
it('breaks excluded gaps and keeps opaque introductions separate',()=>{
 const rows=chapterGroups([source(1),source(2),source(4),{...source(5),id:'opaque',contentPackId:'introPack',sourceKind:'Commentary',chapter:null,verse:null}],new Map());
 expect(rows.map(r=>[r.key,r.sourceUnitIds])).toEqual([
 ['chapter:pack:GEN:1',['v1','v2','v4']],['group:chapter:pack:GEN:1:v1:v2',['v1','v2']],['group:chapter:pack:GEN:1:v4:v4',['v4']],['intro:introPack',['opaque']]]);
});
