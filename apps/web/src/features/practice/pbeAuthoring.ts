import type { PbeAuthorQuestion, PbeTarget } from '../../api/practice';
const fail=():never=>{throw Error('Invalid PBE import. Provide version 2 questions, declared targets and 1–8 points with accepted answers.');};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown,max=10000):v is string=>typeof v==='string'&&!!v.replace(/[\s\u0085]+/gu,'')&&v.length<=max;
const guid=(v:unknown):v is string=>typeof v==='string'&&/^(?!00000000-0000-0000-0000-000000000000$)[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(v);
const ids=(v:unknown):v is string[]=>Array.isArray(v)&&v.length>0&&v.length<=50&&v.every(guid)&&new Set(v.map(s=>s.toLowerCase())).size===v.length;
export function parsePbeImport(json:string):{questions:PbeAuthorQuestion[];targets:PbeTarget[]}{
 let value:unknown;try{value=JSON.parse(json);}catch{return fail();}
 if(!object(value)||!Array.isArray(value.questions)||value.questions.length<1||value.questions.length>100||!Array.isArray(value.targets)||value.targets.length>500)return fail();
 for(const t of value.targets)if(!object(t)||!guid(t.id)||!ids(t.sourceUnitIds)||!text(t.label)||!['FactualRecall','ExactWords'].includes(String(t.skill)))return fail();
 for(const q of value.questions){
  if(!object(q)||q.schemaVersion!==2||!guid(q.id)||!guid(q.contentPackId)||!guid(q.sourceUnitId)||!ids(q.sourceUnitIds)||!q.sourceUnitIds.includes(q.sourceUnitId)||!Number.isInteger(q.version)||Number(q.version)<1||Number(q.version)>2147483647||!['Scripture','Commentary'].includes(String(q.sourceKind))||!['ShortAnswer','List','ExactWords','TrueFalse'].includes(String(q.kind))||!text(q.prompt)||!text(q.reference)||!text(q.evidence)||typeof q.ordered!=='boolean'||!Array.isArray(q.parts)||!q.parts.length||q.parts.length>8)return fail();
  let points=0;for(const p of q.parts){if(!object(p)||!guid(p.targetId)||!Number.isInteger(p.points)||Number(p.points)<1||!Array.isArray(p.acceptedAnswers)||!p.acceptedAnswers.length||p.acceptedAnswers.length>50||!p.acceptedAnswers.every(a=>text(a,2000))||!value.targets.some(t=>t.id===p.targetId))return fail();points+=Number(p.points);}if(points>8)return fail();
 }
 return value as {questions:PbeAuthorQuestion[];targets:PbeTarget[]};
}
