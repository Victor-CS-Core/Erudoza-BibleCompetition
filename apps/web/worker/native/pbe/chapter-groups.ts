import type {PbeSource} from './sources';
export interface ChapterGroup {key:string;parentChapterKey:string|null;kind:'Chapter'|'PassageGroup'|'Introduction';label:string;scopeLabel:string;contentPackId:string;bookKey:string;chapter:number|null;wholeChapterAssigned:boolean|null;sourceUnitIds:string[]}
export function chapterGroups(sources:PbeSource[],inventory:Map<string,string[]>):ChapterGroup[]{
 const parents=new Map<string,PbeSource[]>();
 for(const source of sources){const key=source.sourceKind!=='Scripture'||source.chapter===null?`intro:${source.contentPackId}`:`chapter:${source.contentPackId}:${source.bookKey}:${source.chapter}`;parents.set(key,[...(parents.get(key)??[]),source]);}
 const result:ChapterGroup[]=[];
 for(const [key,units] of [...parents].sort(([,a],[,b])=>a[0].bookKey.localeCompare(b[0].bookKey)||(a[0].sourceKind==='Scripture'?a[0].chapter??Number.MAX_SAFE_INTEGER:Number.MAX_SAFE_INTEGER)-(b[0].sourceKind==='Scripture'?b[0].chapter??Number.MAX_SAFE_INTEGER:Number.MAX_SAFE_INTEGER)||a[0].contentPackId.localeCompare(b[0].contentPackId))){
  units.sort((a,b)=>a.ordinal-b.ordinal||a.id.localeCompare(b.id));const first=units[0],intro=first.sourceKind!=='Scripture'||first.chapter===null;
  const sourceUnitIds=units.map(u=>u.id),canonical=inventory.get(key),whole=!intro&&!!canonical&&canonical.length===sourceUnitIds.length&&canonical.every(id=>sourceUnitIds.includes(id));
  const parent:ChapterGroup={key,parentChapterKey:null,kind:intro?'Introduction':'Chapter',label:intro?`${first.bookKey} introduction`:`${first.bookKey} ${first.chapter}`,scopeLabel:intro?`${units.length} assigned introduction units`:`${units.length} assigned verses`,contentPackId:first.contentPackId,bookKey:first.bookKey,chapter:intro?null:first.chapter,wholeChapterAssigned:intro?null:whole,sourceUnitIds};result.push(parent);
  if(intro)continue;
  const runs:PbeSource[][]=[];
  for(const unit of units){const run=runs.at(-1);if(run&&unit.verse===run.at(-1)!.verse!+1)run.push(unit);else runs.push([unit]);}
  for(const run of runs){const count=Math.ceil(run.length/5),base=Math.floor(run.length/count),extra=run.length%count;let offset=0;
   for(let n=0;n<count;n++){const group=run.slice(offset,offset+base+(n<extra?1:0));offset+=group.length;const start=group[0],end=group.at(-1)!;
    result.push({...parent,key:`group:${key}:${start.id}:${end.id}`,parentChapterKey:key,kind:'PassageGroup',label:`${first.bookKey} ${first.chapter}:${start.verse}${start.verse===end.verse?'':`–${end.verse}`}`,scopeLabel:`${group.length} assigned verses`,wholeChapterAssigned:null,sourceUnitIds:group.map(u=>u.id)});
   }
  }
 }
 return result;
}
