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

it('collapses legacy numeric commentary coordinates into one opaque introduction without mutating sources',()=>{
 const units:PbeSource[]=[{...source(1),sourceKind:'Commentary'},{...source(2),sourceKind:'Commentary',chapter:2}];const before=structuredClone(units);
 const rows=chapterGroups(units,new Map());expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({key:'intro:pack',kind:'Introduction',chapter:null,wholeChapterAssigned:null,scopeLabel:'2 assigned introduction units',sourceUnitIds:['v1','v2']});expect(units).toEqual(before);
});
