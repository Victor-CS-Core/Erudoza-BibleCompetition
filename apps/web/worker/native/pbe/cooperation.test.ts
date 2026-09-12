// @vitest-environment node
import {describe,expect,it} from 'vitest';
import {cooperationTotals,sourceFacts,type CooperationTargetFacts,type SourceFacts,type StudentSource} from './cooperation';
const target=(patch:Partial<CooperationTargetFacts>={}):CooperationTargetFacts=>({targetId:'t',practiced:true,recalled:true,retentionReady:true,recallVariants:2,due:{known:true,unresolved:false,scheduledAtMs:null},...patch});
const yes:SourceFacts={questionCovered:true,practiced:true,recalled:true,retained:true,due:false};
const source=(id:string,facts:SourceFacts|null=yes,pack='p',kind:'Scripture'|'Commentary'='Scripture'):StudentSource=>({sourceUnitId:id,contentPackId:pack,sourceKind:kind,facts});
describe('per-source cooperation facts from normalized Solo inputs',()=>{
 it('requires nonempty targets even when recognition provides question coverage',()=>expect(sourceFacts(true,[],100)).toEqual({questionCovered:true,practiced:false,recalled:false,retained:false,due:false}));
 it('allows aided or recognition participation without granting recall or retention',()=>expect(sourceFacts(true,[target({recalled:false,retentionReady:false,recallVariants:0})],100)).toMatchObject({practiced:true,recalled:false,retained:false}));
 it('preserves a true existential against unknown while a universal remains unknown',()=>expect(sourceFacts(true,[target(),target({targetId:'u',practiced:null,recalled:null,retentionReady:null,recallVariants:null})],100)).toMatchObject({practiced:true,recalled:null,retained:null}));
 it.each([false,null] as const)('known failed universal prerequisite beats unknown coverage %s',coverage=>expect(sourceFacts(coverage,[target({retentionReady:null,recallVariants:1})],100).retained).toBe(false));
 it('retains only with known complete coverage and all eligible variants',()=>expect(sourceFacts(true,[target(),target({targetId:'b'})],100).retained).toBe(true));
 it('counts retained and due independently at the trusted due boundary',()=>expect(sourceFacts(true,[target({due:{known:true,unresolved:false,scheduledAtMs:100}})],100)).toMatchObject({retained:true,due:true}));
 it('preserves known repair despite unknown schedule and leaves initial targets not due',()=>{expect(sourceFacts(true,[target({due:{known:false,unresolved:true,scheduledAtMs:null}})],100).due).toBe(true);expect(sourceFacts(true,[target()],100).due).toBe(false);});
 it('does not treat incomplete due statistics as false',()=>expect(sourceFacts(true,[target({due:{known:false,unresolved:false,scheduledAtMs:null}})],100).due).toBeNull());
});
describe('typed cooperative union and independent individual fractions',()=>{
 it('deduplicates overlapping sources and pairs while keeping different packs and introductions distinct',()=>{
  const result=cooperationTotals([{studentId:'a',sources:[source('1'),source('1'),source('2')]},{studentId:'b',sources:[source('1'),source('1',yes,'edition2'),source('1',yes,'p','Commentary')]}],'a');
  expect(result.scripture).toMatchObject({assigned:3,retained:{known:3,possible:3},equalRetained:{lower:1,upper:1,students:2,unknownStudents:0,unassignedStudents:0}});
  expect(result.introduction).toMatchObject({assigned:1,equalRetained:{students:1,unassignedStudents:1}});
  expect(result.own?.scripture).toMatchObject({assigned:2,retained:{known:2,possible:2}});
 });
 it('keeps unknown members in denominator and uses equal student weighting instead of pooled source weighting',()=>{
  const result=cooperationTotals([{studentId:'small',sources:[source('1')]},{studentId:'large',sources:[source('2',null),source('3',null),source('4',null)]},{studentId:'empty',sources:[]}],'large');
  expect(result).toMatchObject({rosterStudents:3,unknownStudents:1,scripture:{assigned:4,retained:{known:1,possible:4},equalRetained:{lower:0.5,upper:1,students:2,unknownStudents:1,unassignedStudents:1}},own:{state:'Unknown',scripture:{assigned:3,retained:{known:0,possible:3}}}});
 });
 it('a known true assignee dominates unknown overlap without inflating possible union',()=>{
  const result=cooperationTotals([{studentId:'a',sources:[source('1')]},{studentId:'b',sources:[source('1',null)]}],'b');
  expect(result.scripture.retained).toEqual({known:1,possible:1});expect(result.own?.scripture.retained).toEqual({known:0,possible:1});
 });
 it('zero and introduction-only denominators remain null/unassigned',()=>{
  expect(cooperationTotals([]).scripture.equalRetained).toBeNull();
  const result=cooperationTotals([{studentId:'a',sources:[source('intro',yes,'p','Commentary')]},{studentId:'empty',sources:[]}],'empty');
  expect(result.scripture.equalRetained).toBeNull();expect(result.own?.state).toBe('Unassigned');expect(result.introduction.assigned).toBe(1);
 });
});
it('rejects a nonfinite publication time',()=>expect(()=>sourceFacts(true,[target()],NaN)).toThrow('finite'));
it('Team evidence cannot become Solo practice through the accepted normalized fold',async()=>{
 const {advanceRetention,initialRetentionState,retentionReady}=await import('./chapters');
 const state=advanceRetention(initialRetentionState(),{activity:'Team',targetId:'t',questionId:'q',questionVersion:1,attemptId:'a',atMs:0,acceptedSequence:1,fullCredit:true,unaided:true,final:true,recall:true});
 expect(sourceFacts(true,[target({practiced:state.practiced,recalled:state.recalled,retentionReady:retentionReady(state)})],100)).toMatchObject({practiced:false,recalled:false,retained:false});
});
it('known false assignees keep source union false and future maintenance is not yet due',()=>{
 const facts=sourceFacts(true,[target({practiced:false,recalled:false,retentionReady:false,due:{known:true,unresolved:false,scheduledAtMs:101}})],100);
 const result=cooperationTotals([{studentId:'a',sources:[source('1',facts)]},{studentId:'b',sources:[source('1',facts)]}]);
 expect(result.scripture).toMatchObject({assigned:1,practiced:{known:0,possible:0},retained:{known:0,possible:0},due:{known:0,possible:0}});
});
it('uses portable UTF8 bytes for Unicode, supplementary characters and JSON control escaping',async()=>{
 const {chapterHash}=await import('./chapter-manifest');
 const fixture=['pbe-cooperation-v1','é "quote" \\ line\n\u0001 🧭',['Commentary','Ω','引用']];
 expect(new TextEncoder().encode(JSON.stringify(fixture)).byteLength).toBe(87);
 expect(await chapterHash(fixture)).toBe('9d9014690e262fe471adbf8b174de7ac5c1c6752d94e404a76d67243b05c4952');
});
it('counts complete returned D1 rows independently of unavailable engine row metadata',async()=>{
 const {measureD1Fetch}=await import('../test-d1-meter');
 const db={prepare:(sql:string)=>({first:async()=>sql==='missing'?null:0,all:async()=>({results:[{id:1},{id:2}],meta:{rows_read:12}}),raw:async()=>[['column'],['value']],run:async()=>({results:[],meta:{rows_read:3}})}),batch:async()=>[{results:[{id:3}],meta:{rows_read:4}},{results:[],meta:{rows_read:0}}]};
 const handler=measureD1Fetch(async(_request,env)=>{await env.DB.prepare('scalar').first();await env.DB.prepare('missing').first();await env.DB.prepare('rows').all();await env.DB.prepare('raw').raw();await env.DB.prepare('mutation').run();await env.DB.batch([env.DB.prepare('batch rows'),env.DB.prepare('batch mutation')]);return new Response('{}');});
 const response=await handler(new Request('https://test.invalid'),{DB:db} as unknown as import('../types').Env),meter=JSON.parse(response.headers.get('x-test-d1-meter')!);
 expect(meter).toMatchObject({returnedRows:6,maxReturnedRowsPerQuery:2,knownRowsRead:19,firstQueriesWithoutRowsRead:2,statements:7});
});
