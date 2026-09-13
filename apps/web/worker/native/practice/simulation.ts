import {bibleBookName} from '../application/catalog';
import {HttpError} from '../types';
import type {PbeSource} from '../pbe/sources';
export interface SimulationSettings {version:1;scope?:'AllAssigned'|'SelectedChapters';preset:'FullEvent'|'ShortPractice'|'Custom';bookKeys:string[];chapters:{bookKey:string;chapter:number}[];includeScripture:boolean;includeIntroductions:boolean;timeMultiplier:1|1.5|2;halfTime:boolean;discussion:'InPerson'|'Chat';audioPresenterId?:string}
function need(ok:unknown,message:string):asserts ok {if(!ok)throw new HttpError(400,message);}
export function validateSimulation(value:SimulationSettings,count:number,members:string[]):SimulationSettings {
 need(value&&typeof value==='object'&&value.version===1,'Choose supported simulation settings.');
 need(['FullEvent','ShortPractice','Custom'].includes(value.preset)&&[10,30,90].includes(count),'Choose a simulation preset and question count.');
 need(Array.isArray(value.bookKeys)&&value.bookKeys.length<=66&&value.bookKeys.every(k=>typeof k==='string'&&/^[A-Z0-9]{2,8}$/.test(k))&&new Set(value.bookKeys).size===value.bookKeys.length,'Choose distinct known books.');
 need(Array.isArray(value.chapters)&&value.chapters.length<=1189&&value.chapters.every(c=>c&&value.bookKeys.includes(c.bookKey)&&Number.isInteger(c.chapter)&&c.chapter>0&&c.chapter<=150)&&new Set(value.chapters.map(c=>`${c.bookKey}:${c.chapter}`)).size===value.chapters.length,'Choose explicit chapters within selected books.');
 need(value.scope===undefined||['AllAssigned','SelectedChapters'].includes(value.scope),'Choose all assigned material or selected chapters.');
 need(value.scope!=='SelectedChapters'||value.chapters.length>0&&value.bookKeys.length>0,'Select at least one explicit chapter.');
 need(value.scope!=='AllAssigned'||value.chapters.length===0,'All assigned material cannot contain selected chapters.');
 need(typeof value.includeScripture==='boolean'&&typeof value.includeIntroductions==='boolean'&&(value.includeScripture||value.includeIntroductions),'Include at least one material source.');
 need([1,1.5,2].includes(value.timeMultiplier)&&typeof value.halfTime==='boolean'&&(!value.halfTime||count===90)&&['InPerson','Chat'].includes(value.discussion),'Choose valid timing and discussion settings.');
 need(value.preset!=='FullEvent'||count===90&&value.timeMultiplier===1&&value.halfTime,'Full event requires 90 questions, standard time and halftime.');
 need(value.preset!=='ShortPractice'||[10,30].includes(count)&&value.timeMultiplier===1&&!value.halfTime,'Short practice requires 10 or 30 questions and standard timing without halftime.');
 need(value.audioPresenterId===undefined||typeof value.audioPresenterId==='string'&&members.includes(value.audioPresenterId),'Choose a current member as audio presenter.');
 need(value.discussion!=='InPerson'||!!value.audioPresenterId,'Choose the audio presenter.');
 return structuredClone(value);
}
export function filterSimulationSources(sources:PbeSource[],settings:SimulationSettings):PbeSource[]{
 const all=settings.scope==='AllAssigned'||settings.scope===undefined&&!settings.chapters.length;
 if(all)return sources.filter(s=>s.sourceKind==='Scripture'?settings.includeScripture:settings.includeIntroductions);
 need(settings.chapters.length>0&&settings.bookKeys.length>0,'Select at least one explicit chapter.');
 const books=new Set(sources.map(s=>s.bookKey));
 need(settings.bookKeys.every(k=>books.has(k)),'Selected books are no longer available.');
 need(settings.chapters.every(c=>sources.some(s=>s.sourceKind==='Scripture'&&s.bookKey===c.bookKey&&s.chapter===c.chapter)),'Selected chapters are no longer available.');
 return sources.filter(s=>(!settings.bookKeys.length||settings.bookKeys.includes(s.bookKey))&&(s.sourceKind==='Scripture'?settings.includeScripture&&(!settings.chapters.length||settings.chapters.some(c=>c.bookKey===s.bookKey&&c.chapter===s.chapter)):settings.includeIntroductions));
}

export function simulationMaterial(seasonId:string,sources:PbeSource[]){const keys=[...new Set(sources.map(s=>s.bookKey))].sort();return {seasonId,translation:'NKJV',books:keys.map(key=>({key,label:bibleBookName(key),chapters:[...new Set(sources.filter(s=>s.bookKey===key&&s.sourceKind==='Scripture'&&s.chapter!==null).map(s=>s.chapter!))].sort((a,b)=>a-b)})),introductionsAvailable:sources.some(s=>s.sourceKind==='Commentary')};}
