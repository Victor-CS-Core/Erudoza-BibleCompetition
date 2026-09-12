import type { MaterialSummary, OwnSummary } from '../../../src/api/pbeTypes';
export type Truth = true | false | null;
export type SourceIdentity = { sourceKind:'Scripture'|'Commentary'; contentPackId:string; sourceUnitId:string };
export type DueFacts = { known:boolean; unresolved:Truth; scheduledAtMs:number|null };
/** Already eligible targets with normalized D1 Solo facts; never attempts or Team outcomes. */
export type CooperationTargetFacts = { targetId:string; practiced:Truth; recalled:Truth; retentionReady:Truth; recallVariants:number|null; due:DueFacts };
export type SourceFacts = { questionCovered:Truth; practiced:Truth; recalled:Truth; retained:Truth; due:Truth };
export type StudentSource = SourceIdentity & { facts:SourceFacts|null };
export type CooperationStudent = { studentId:string; sources:StudentSource[] };
export type CooperationTotals = { rosterStudents:number; unknownStudents:number; scripture:MaterialSummary; introduction:MaterialSummary; own:OwnSummary|null };
const metrics = ['questionCovered','practiced','retained','due'] as const;
const any = (facts:Truth[]):Truth => facts.includes(true) ? true : facts.includes(null) ? null : false;
const all = (facts:Truth[]):Truth => facts.includes(false) ? false : facts.includes(null) ? null : true;
const sourceKey = (source:SourceIdentity):string => JSON.stringify([source.sourceKind,source.contentPackId,source.sourceUnitId]);

/** All inputs are already scoped and normalized by D1; this cannot authorize or replay evidence. */
export function sourceFacts(questionCovered:Truth, targets:CooperationTargetFacts[], checkedAtMs:number):SourceFacts {
  if(!Number.isFinite(checkedAtMs))throw new Error('Provide a finite cooperation check time.');
  const distinct=[...new Map(targets.map(target=>[target.targetId,target])).values()];
  return {
    questionCovered,
    practiced:any(distinct.map(target=>target.practiced)),
    recalled:all([distinct.length>0,...distinct.map(target=>target.recalled)]),
    retained:all([questionCovered,distinct.length>0,...distinct.flatMap(target=>[target.retentionReady,target.recallVariants===null?null:target.recallVariants>=2])]),
    due:any(distinct.map(({due})=>any([due.unresolved,due.scheduledAtMs!==null&&due.scheduledAtMs<=checkedAtMs?true:due.known?false:null]))),
  };
}

const emptyRange = () => ({known:0,possible:0});
function personal(sources:StudentSource[]) {
  const result={assigned:sources.length,practiced:emptyRange(),retained:emptyRange(),due:emptyRange()};
  for(const source of sources)for(const metric of ['practiced','retained','due'] as const){
    const value=source.facts?.[metric]??null;
    if(value===true)result[metric].known++;
    if(value!==false)result[metric].possible++;
  }
  return result;
}
const unknown = (source:StudentSource) => source.facts===null||metrics.some(metric=>source.facts![metric]===null);
function material(students:CooperationStudent[], kind:SourceIdentity['sourceKind']):MaterialSummary {
  const union=new Map<string,StudentSource[]>();
  let lower=0,upper=0,included=0,unknownStudents=0;
  for(const student of students){
    const sources=student.sources.filter(source=>source.sourceKind===kind);
    for(const source of sources){const key=sourceKey(source);const assignees=union.get(key)??[];assignees.push(source);union.set(key,assignees);}
    if(!sources.length)continue;
    included++;
    const own=personal(sources);
    lower+=own.retained.known/own.assigned;upper+=own.retained.possible/own.assigned;
    if(own.retained.known!==own.retained.possible)unknownStudents++;
  }
  const result:MaterialSummary={assigned:union.size,questionCovered:emptyRange(),practiced:emptyRange(),retained:emptyRange(),due:emptyRange(),equalRetained:included?{lower:lower/included,upper:upper/included,students:included,unknownStudents,unassignedStudents:students.length-included}:null};
  for(const assignees of union.values())for(const metric of metrics){
    const value=any(assignees.map(source=>source.facts?.[metric]??null));
    if(value===true)result[metric].known++;
    if(value!==false)result[metric].possible++;
  }
  return result;
}

/** Reference reduction over compact, capped facts, with exact assignments supplied even for unknown owners. */
export function cooperationTotals(input:CooperationStudent[], ownStudentId?:string):CooperationTotals {
  const students=input.map(student=>({...student,sources:[...new Map(student.sources.map(source=>[sourceKey(source),source])).values()]}));
  const ownStudent=students.find(student=>student.studentId===ownStudentId);
  const own:OwnSummary|null=ownStudent?{
    scripture:personal(ownStudent.sources.filter(source=>source.sourceKind==='Scripture')),
    introduction:personal(ownStudent.sources.filter(source=>source.sourceKind==='Commentary')),
    state:!ownStudent.sources.length?'Unassigned':ownStudent.sources.some(unknown)?'Unknown':'Known',
  }:null;
  return {rosterStudents:students.length,unknownStudents:students.filter(student=>student.sources.some(unknown)).length,scripture:material(students,'Scripture'),introduction:material(students,'Commentary'),own};
}
