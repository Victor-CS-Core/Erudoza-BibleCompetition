import { HttpError } from "../types";
export interface Question { id:string; contentPackId:string; sourceUnitId:string; prompt:string; kind:string; parts:{acceptedAnswers:string[];points:number}[]; ordered:boolean; evidence:string; reference:string; version:number }
export const points=(q:{parts:{points:number}[]})=>q.parts.reduce((n,p)=>n+p.points,0);
export const duration=(q:Question)=>20+5*points(q);
const normalize=(text:string)=>Array.from(text.normalize("NFC")).map(ch=>{const upper=ch.toUpperCase();return upper.length===ch.length?upper:ch;}).join("")
 // .NET whitespace includes NEL and excludes BOM; invariant casing never expands ß into SS.
 // eslint-disable-next-line no-control-regex
 .replace(/[\u0009-\u000d\u0085\p{Z}]+/gu," ").replace(/^ +| +$/g,"");
export function validateQuestion(q:Question):void {
  if(!q||![q.id,q.contentPackId,q.sourceUnitId,q.prompt,q.evidence,q.reference].every(v=>typeof v==="string"&&v.trim().length>0&&v.length<=10000)||!Number.isInteger(q.version)||q.version<1) throw new HttpError(400,"Question identity, version, prompt and source evidence are required.");
  if(!["ShortAnswer","List","ExactWords","TrueFalse"].includes(q.kind)) throw new HttpError(400,"Unsupported question kind.");
  if(!Array.isArray(q.parts)||q.parts.length<1||q.parts.length>50||q.parts.some(p=>!p||!Number.isInteger(p.points)||p.points<1||p.points>100||!Array.isArray(p.acceptedAnswers)||!p.acceptedAnswers.length||p.acceptedAnswers.length>50||p.acceptedAnswers.some(a=>typeof a!=="string"||!a.trim()||a.length>2000))) throw new HttpError(400,"Provide 1–50 scoring parts with 1–100 points and accepted answers.");
  if(q.kind==="TrueFalse"&&(q.parts.length!==1||q.parts[0].acceptedAnswers.some(a=>!["TRUE","FALSE"].includes(normalize(a)))||new Set(q.parts[0].acceptedAnswers.map(normalize)).size!==1)) throw new HttpError(400,"Provide one unambiguous true/false answer.");
}
export function evaluate(q:Question,answers:string[]):number {
  validateQuestion(q); const submitted=answers.map(normalize), accepted=q.parts.map(p=>new Set(p.acceptedAnswers.map(normalize)));
  if(q.ordered||q.kind==="ExactWords") return q.parts.reduce((sum,p,i)=>sum+(accepted[i].has(submitted[i])?p.points:0),0);
  const assignments=new Array<number>(answers.length).fill(-1);
  function assign(part:number,visited:boolean[]):boolean { for(let i=0;i<answers.length;i++) if(!visited[i]&&accepted[part].has(submitted[i])) { visited[i]=true; if(assignments[i]<0||assign(assignments[i],visited)) { assignments[i]=part;return true; } } return false; }
  return q.parts.map((p,i)=>({p,i})).sort((a,b)=>b.p.points-a.p.points).reduce((sum,{p,i})=>sum+(assign(i,new Array(answers.length).fill(false))?p.points:0),0);
}
export function score(accuracy:number,seconds:number,elapsedMs:number,deadline=false):{accuracyHundredths:number;speedHundredths:number} {
  if(!Number.isInteger(accuracy)||accuracy<0||accuracy>5000||!Number.isInteger(seconds)||seconds<=0||!Number.isFinite(elapsedMs)||elapsedMs<0) throw new HttpError(400,"Invalid score timing or accuracy.");
  if(elapsedMs>seconds*1000) return {accuracyHundredths:0,speedHundredths:0};
  return {accuracyHundredths:accuracy*100,speedHundredths:deadline?0:Math.floor(25*accuracy*(seconds-Math.min(seconds,Math.ceil(elapsedMs/1000)))/seconds)};
}
