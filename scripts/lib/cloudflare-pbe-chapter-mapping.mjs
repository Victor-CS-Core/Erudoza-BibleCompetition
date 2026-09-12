import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const bytes=value=>Buffer.byteLength(typeof value==='string'?value:JSON.stringify(value));
const fail=message=>{throw new Error(`PBE chapter mapping blocked: ${message}`);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const lower=value=>typeof value==='string'?value.toLowerCase():value;
const sort=(a,b)=>a<b?-1:a>b?1:0;
const tupleSort=(a,b)=>sort(JSON.stringify(a),JSON.stringify(b));
const range=r=>[r.BookKey,r.StartChapter,r.StartVerse,r.EndChapter,r.EndVerse];

/** Deliberate conversion of canonical v1 tuple pages into the accepted native v1 codec.
 * Original rows remain separately archived. This function performs no reads or writes.
 */
export function mapCanonicalChapters({rows,nativeCore,operationalRecords,snapshot,codec:c}){
 const {shape,fields,str,integer,positive,bool,nullable,array,lit,parseCanonicalJson:parse,projection,question,target,candidate,timestamp}=c;
 const textNull=nullable(str),intNull=nullable(integer),boolNull=nullable(bool);
 const counts=shape(fields('assignedPassages questionCoveredPassages totalTargets practicedTargets recalledTargets retainedTargets dueTargets missingVariantTargets',integer));
 const summary=shape({...fields('stampId chapterKey kind label scopeLabel scopeVersion'),ruleVersion:lit('pbe-chapter-v1'),earnedAtUtc:timestamp,matchesCurrentScope:boolNull});
 const progressRow=shape({...fields('key kind label scopeLabel contentPackId bookKey currentReadiness'),parentChapterKey:textNull,chapter:intNull,wholeChapterAssigned:boolNull,counts,stamp:nullable(summary),hasHistoricalStamps:bool,actions:array(shape({mode:lit('Practice','Review'),label:str,progressScope:shape(fields('key scopeVersion'))}))});
 const group=shape({...fields('key kind contentPackId bookKey label scopeLabel sortKey'),parentChapterKey:textNull,chapter:intNull,assignedPassages:integer});
 const aggregate=shape({group,targetAfter:str,counts,updating:bool,repair:bool});
 const workSchema=shape({schemaVersion:lit(1),...fields('id state asOfUtc dueRefreshAtUtc'),stage:textNull,reason:textNull,scopeVersion:textNull,...fields('inputOffset inputPages stagedBytes rowOffset',integer),snapshotId:textNull},{abandonedId:textNull,...fields('proofOffset proofPages sourceCount scriptureCount familyRows proofBytes',integer),proofFingerprint:textNull,...fields('capturePhase after groupAfter'),aggregate:nullable(aggregate)});
 const witnessPage=shape({...fields('generationId family hash'),entries:array(shape({targetId:str,witness:(v,p)=>{array(candidate)(v,p);if(v.length!==2)fail(`${p}: expected witness pair`);}}))});
 const stampSchema=shape({summary,...fields('proofGenerationId proofFamily proofHash'),...fields('targetCount qualifyingAttemptCount proofPageCount',integer)});
 const byScope=new Map(),result=[];
 for(const row of rows){const key=JSON.stringify([row.org_id,row.season_id,row.owner_id]);if(!byScope.has(key))byScope.set(key,[]);byScope.get(key).push(row);}
 const native=[...nativeCore.records,...operationalRecords].map(r=>({...r,data:typeof r.data==='string'?parse(r.data,r.kind):r.data,revision:r.revision??1}));
 for(const owned of byScope.values()){
  const {org_id:org,season_id:season,owner_id:owner}=owned[0];if(!owner||!season)fail('chapter ownership missing');
  const find=(kind,id,nullable=false)=>{const found=native.filter(r=>r.kind===kind&&r.id===id&&(r.org_id===org||['pack','source'].includes(kind)&&r.org_id==='00000000-0000-4000-8000-000000000066'));if(found.length>1)fail(`ambiguous native dependency ${kind}:${id}`);if(!found.length&&!nullable)fail(`missing native dependency ${kind}:${id}`);return found[0]??null;};
  const guard=(kind,id)=>{const r=find(kind,id,true);return {kind,id,revision:r?.revision??null};};
  const add=(source,value,id=source.id)=>{const data=JSON.stringify(value);if(bytes(data)>65536)fail('converted page exceeds 64 KiB');result.push({...source,id,data});};
  const inputRows=owned.filter(r=>r.kind==='pbe-chapter-manifest');
  const proofs=owned.filter(r=>r.kind==='pbe-chapter-stamp-proof');
  const stamps=owned.filter(r=>r.kind==='pbe-chapter-stamp');
  const projections=owned.filter(r=>r.kind==='pbe-chapter-projection');
  const pointers=owned.filter(r=>r.kind==='pbe-chapter-work');
  if(pointers.length>1)fail('multiple work pointers for owner');
  for(const row of owned)if(!['pbe-chapter-manifest','pbe-chapter-stamp-proof','pbe-chapter-stamp','pbe-chapter-projection','pbe-chapter-work'].includes(row.kind))fail(`unsupported kind ${row.kind}`);
  const proofValues=new Map();
  for(const row of proofs){
   const p=parse(row.data,'chapter witness');witnessPage(p,'chapter witness');
   if(row.revision!==1||row.id!==`${p.generationId}:${p.family}:${row.id.split(':').at(-1)}`||!/^proof-\d{6}$/.test(p.family)||!/^\d{6}$/.test(row.id.split(':').at(-1)))fail('invalid immutable witness identity/revision');
   if(p.hash!==hash(p.entries))fail('witness hash mismatch');
   proofValues.set(row.id,p);add(row,{id:row.id,...p});
  }
  for(const row of stamps){
   const p=parse(row.data,'chapter stamp');stampSchema(p,'chapter stamp');
   if(row.revision!==1||row.id!==p.summary.stampId||row.id!==`${owner}:${season}:${hash([p.summary.chapterKey,p.summary.scopeVersion,'pbe-chapter-v1'])}`)fail('immutable stamp identity/revision mismatch');
   const pages=proofs.filter(r=>{const v=proofValues.get(r.id);return v.generationId===p.proofGenerationId&&v.family===p.proofFamily;}).sort((a,b)=>sort(a.id,b.id));
   const entries=pages.flatMap(r=>proofValues.get(r.id).entries);
   if(pages.length!==p.proofPageCount||entries.length!==p.targetCount||new Set(entries.map(e=>e.targetId)).size!==p.targetCount||p.qualifyingAttemptCount!==p.targetCount*2||hash(pages.map(r=>[r.id,proofValues.get(r.id).hash]))!==p.proofHash)fail('stamp proof closure mismatch');
   add(row,{id:row.id,...p});
  }
  for(const row of projections){const p=parse(row.data,'chapter projection');shape({row:progressRow,evidenceFingerprint:str})(p,'chapter projection');if(row.revision!==1||!/^.+:\d{6}$/.test(row.id))fail('immutable projection identity/revision mismatch');add(row,{id:row.id,generationId:row.id.slice(0,row.id.lastIndexOf(':')),row:p.row,canonicalProvenance:{version:1,evidenceFingerprint:p.evidenceFingerprint}});}
  const generations=new Map();
  for(const row of inputRows){
   const match=/^([^:]+):inputs:(\d{6})$/.exec(row.id);if(!match||row.revision!==1)fail('invalid canonical manifest identity/revision');
   const entries=parse(row.data,'chapter manifest');array(str)(entries,'chapter manifest');if(entries.length>128||bytes(row.data)>65536)fail('canonical manifest exceeds page bound');
   const list=generations.get(match[1])??[];list.push({row,ordinal:Number(match[2]),entries:entries.map((e,i)=>parse(e,`chapter tuple ${i}`))});generations.set(match[1],list);
  }
  const work=pointers[0]?parse(pointers[0].data,'chapter work'):null;if(work)workSchema(work,'chapter work');
  if(work&&pointers[0].id!==`${owner}:${season}`)fail('work owner identity mismatch');
  if(work&&!['replay','retentions','seal','aggregate'].includes(work.capturePhase??'scope'))fail(`unsupported early capture cursor ${work.capturePhase??'scope'}`);
  if(work&&work.state!=='Complete'&&work.state!=='Working')fail(`unsupported work state ${work.state}`);
  if(work?.abandonedId)fail('unsupported partially cleaned abandoned generation');
  if(work&&!generations.has(work.id))fail('work manifest generation absent');
  for(const [generation,pages] of generations){
   pages.sort((a,b)=>a.ordinal-b.ordinal);if(pages.some((p,i)=>p.ordinal!==i))fail('manifest ordinal gap');
   const tuples=pages.flatMap(p=>p.entries),families={sources:[],guards:[],targets:[],heads:[],groups:[],retentions:[],evidence:[]};
   const controls=[],banks=[],targets=new Map(),questions=new Map(),retentions=[];
   for(const t of tuples){
    if(!Array.isArray(t)||typeof t[0]!=='string')fail('invalid manifest tuple');
    switch(t[0]){
    case 'control':controls.push(t);break;
    case 'source':{
     if(t.length!==10)fail('source tuple shape');const [,id,contentPackId,sourceKind,bookKey,chapter,verse,ordinal,citation,textHash]=t;
     const record=find('source',id,true),intro=record?null:find('pbe-introduction',contentPackId);const unit=record?.data??intro.data.units.find(x=>x.id===id);if(!unit)fail('source unit missing');
     const actual=record?[id,contentPackId,find('pack',contentPackId).data.sourceType==='Scripture'?'Scripture':'Commentary',unit.bookKey,unit.chapter,unit.verse,unit.ordinal,unit.citation,hash(unit.canonicalText)]:[id,contentPackId,'Commentary',intro.data.bookKey,null,null,intro.data.units.indexOf(unit)+1,unit.citation,hash(unit.canonicalText)];
     if(!same(t.slice(1),actual))fail('unrepresentable stale canonical source guard');
     families.sources.push({id,contentPackId,sourceKind,bookKey,chapter,verse,ordinal,citation,textHash,parentKey:sourceKind==='Scripture'&&chapter!==null?`chapter:${contentPackId}:${bookKey}:${chapter}`:`intro:${contentPackId}`,groupKey:null,guards:record?[guard('source',id),guard('pack',contentPackId)]:[guard('pbe-introduction',contentPackId)]});break;
    }
    case 'bank':if(t.length!==5||!['pbe-target','pbe-question-head'].includes(t[1]))fail('bank guard shape');positive(t[4],'bank revision');banks.push(t);break;
    case 'target':if(t.length!==3)fail('target tuple shape');{const v=parse(t[2],'compact target');target(v,'compact target');if(v.id!==t[1]||targets.has(v.id))fail('target identity collision');targets.set(v.id,v);}break;
    case 'question':if(t.length!==3)fail('question tuple shape');{const v=parse(t[2],'compact question');question(v,'compact question');if(v.id!==t[1]||questions.has(v.id))fail('question identity collision');questions.set(v.id,v);}break;
    case 'retention':if(t.length!==4)fail('retention tuple shape');{const v=parse(t[2],'captured retention');projection(v,'captured retention');positive(t[3],'retention revision');if(v.targetId!==t[1])fail('retention target mismatch');retentions.push({targetId:t[1],projection:v,revision:t[3]});}break;
    default:fail(`unsupported manifest tuple ${t[0]}`);
    }
   }
   const seasonRecord=find('season',season),scope=find('scope',season,true),membership=find('membership',`${season}:${owner}`,true);
   const actor=nativeCore.users.find(u=>u.id===owner&&u.org_id===org);if(!actor)fail('chapter actor absent');
   const baseGuards=[guard('season',season),guard('scope',season),guard('membership',`${season}:${owner}`),{kind:'@active-user',id:owner,revision:0}];
   const actorProjection={active:Number(actor.active),kind:actor.kind,role:actor.role};
   const baseRow={revision:seasonRecord.revision,organizationId:seasonRecord.data.organizationId,status:seasonRecord.data.status,enabled:seasonRecord.data.pbeEnabled?1:0,scopeRevision:scope?.revision??null,membershipRevision:membership?.revision??null};
   const sourceHash=hash([org,season,owner,actorProjection,baseRow,baseGuards]);
   families.guards.push(...baseGuards);
   const expected=controlTuples(snapshot,org,season,owner,find);
   const selected=currentSourceIds(native,org,season,owner,scope,membership);if(!same(selected,[...new Set(families.sources.map(s=>s.id))].sort())||families.sources.length!==selected.length)fail('incomplete captured source set');
   if(!same(controls.slice().sort(tupleSort),expected.sort(tupleSort)))fail('unrepresentable stale/incomplete canonical control guard set');
   for(const t of controls){
    if(t[1]==='assignment-scope'){const a=find('assignment',t[3]);const tuple=['assignment',t[3],...t.slice(4)];families.guards.push({...guard('assignment',a.id),assignmentTuple:tuple,introductionGuard:null});}
    if(t[1]==='intro-assignment')families.guards.push({...guard('pbe-introduction-assignment',t[2]),assignmentTuple:['pbe-introduction-assignment',t[2],t[4],null,null,null,null,null],introductionGuard:guard('pbe-introduction',t[4])});
   }
   for(const t of banks){const [,kind,id,ownerId,revision]=t;
    const g={kind,id,ownerId,revision};
    if(kind==='pbe-target'){const v=targets.get(id);families.targets.push({guard:g,target:v?{id:v.id,skill:v.skill,sourceUnitIds:v.sourceUnitIds}:null});}
    else {const v=questions.get(id);families.heads.push({guard:g,question:v?{id:v.id,version:v.version,sourceUnitIds:v.sourceUnitIds,kind:v.kind,ordered:v.ordered,parts:v.parts.map(p=>({targetId:p.targetId,points:p.points}))}:null});}
   }
   if(targets.size!==families.targets.filter(t=>t.target).length||questions.size!==families.heads.filter(t=>t.question).length)fail('bank compact records lack exact guards');
   families.groups=groupsForSources(families.sources);
   families.retentions=retentions.map(({targetId,projection})=>({targetId,projection}));families.evidence=retentions.map(r=>({kind:'pbe-target-review',id:r.projection.id,revision:r.revision}));
   if(new Set(banks.map(t=>JSON.stringify([t[1],t[2]]))).size!==banks.length||new Set(retentions.map(t=>t.targetId)).size!==retentions.length)fail('duplicate captured bank/retention identity');
   const convertedPages=[];let pageCount=0,total=0;
   for(const [family,entries] of Object.entries(families)){
    let pending=[];const flush=()=>{if(!pending.length)return;const id=`${generation}:${family}:${String(pageCount).padStart(6,'0')}`,page={id,generationId:generation,family,ordinal:pageCount,entries:pending,bytes:0,hash:hash(pending)};while(page.bytes!==bytes(page))page.bytes=bytes(page);if(page.bytes>65536)fail('converted manifest page exceeds 64 KiB');convertedPages.push(page);pageCount++;total+=page.bytes;pending=[];};
    for(const e of entries){if(pending.length>=128||bytes([...pending,e])+1000>65536)flush();pending.push(e);}flush();
   }
   const template=pages[0].row;
   for(const p of convertedPages)add({...template,id:p.id},p);
   const originalProofBytes=proofs.filter(r=>proofValues.get(r.id).generationId===generation).reduce((sum,r)=>sum+bytes(r.data),0);
   const proofBytes=proofs.filter(r=>proofValues.get(r.id).generationId===generation).reduce((sum,r)=>sum+bytes({id:r.id,...proofValues.get(r.id)}),0);total+=proofBytes;
   if(total>16*1024*1024)fail('converted generation exceeds total staging budget');
   if(work?.id===generation){
    if(work.proofFingerprint!=null)fail('unsupported non-null proof fingerprint');
    if(work.sourceCount!==families.sources.length||work.scriptureCount!==families.sources.filter(s=>s.sourceKind==='Scripture').length)fail('original source accounting mismatch');
    if(work.rowOffset!==projections.filter(r=>r.id.startsWith(generation+':')).length)fail('original row accounting mismatch');
    const published=projections.filter(r=>r.id.startsWith(generation+':')).sort((a,b)=>sort(a.id,b.id));
    if(published.some((r,i)=>r.id!==`${generation}:${String(i).padStart(6,'0')}`||parse(r.data,'published row').row.key!==families.groups[i]?.key))fail('published projection group/ordinal mismatch');
    if(work.state==='Complete'&&(work.snapshotId!==generation||published.length!==families.groups.length||work.aggregate))fail('complete work projection closure mismatch');
    const pendingProofs=proofs.filter(r=>proofValues.get(r.id).generationId===generation&&proofValues.get(r.id).family===`proof-${String(work.rowOffset).padStart(6,'0')}`);
    if((work.proofPages??0)!==pendingProofs.length||(work.proofOffset??0)!==pendingProofs.reduce((n,r)=>n+proofValues.get(r.id).entries.length,0))fail('original pending proof accounting mismatch');
    if(work.inputPages!==pages.length||work.inputOffset!==tuples.length||work.stagedBytes!==pages.reduce((n,p)=>n+bytes(p.row.data),0)+(work.proofBytes??0)||originalProofBytes!==(work.proofBytes??0))fail('original generation accounting mismatch');
    const w={id:pointers[0].id,workId:work.id,schemaVersion:1,seasonId:season,baseGuards,sourceHash,stage:work.state==='Complete'?'Complete':{replay:'Replaying',retentions:'Retentions',seal:'Projecting',aggregate:'Projecting'}[work.capturePhase],offset:0,after:work.after??'',pageCount,bytes:total,proofBytes,scopeVersion:work.scopeVersion,asOfUtc:work.asOfUtc,dueRefreshAtUtc:work.dueRefreshAtUtc,reason:work.reason,snapshotId:work.snapshotId,abandoned:null,rowIndex:work.rowOffset,groupAfter:work.groupAfter??'',aggregate:work.aggregate?{...work.aggregate,group:{...work.aggregate.group,wholeChapterAssigned:work.aggregate.group.kind==='Chapter'?false:null}}:null,proofOffset:work.proofOffset??0};
    if(w.scopeVersion!==null){
     const portable=hash(['pbe-chapter-v1','pbe-passage-groups-v1',season,owner,families.sources.slice().sort((a,b)=>sort(a.id,b.id)).map(s=>[s.id,s.contentPackId,s.sourceKind,s.bookKey,s.chapter,s.verse,s.ordinal,s.citation,s.textHash]),[...targets.values()].sort((a,b)=>sort(a.id,b.id)).map(t=>[t.id,[...t.sourceUnitIds].sort(),t.skill]),[...questions.values()].sort((a,b)=>sort(a.id,b.id)||a.version-b.version).map(q=>[q.id,q.version,[...q.sourceUnitIds].sort(),q.kind,q.ordered,q.parts.map(p=>[p.targetId,p.points])]),families.guards.filter(g=>g.assignmentTuple).map(g=>g.assignmentTuple).sort(tupleSort)]);
     if(portable!==w.scopeVersion)fail('portable scope hash mismatch');
    }
    add(pointers[0],w);
   }
  }
  if(!work&&inputRows.length)fail('manifest without resumable work pointer');
 }
 return result;
}
function controlTuples(snapshot,org,season,owner,find){
 const rows=name=>snapshot.tables[name]??[],owned=r=>lower(r.OrganizationId)===org,seasonOwned=r=>owned(r)&&lower(r.SeasonId)===season;
 const assignments=rows('Assignments').filter(r=>seasonOwned(r)&&lower(r.StudentUserId)===owner),ids=new Set(assignments.map(r=>lower(r.Id)));
 const scopes=rows('AssignmentScopes').filter(r=>ids.has(lower(r.AssignmentId)));
 if(assignments.some(a=>scopes.filter(s=>lower(s.AssignmentId)===lower(a.Id)).length!==1))fail('unsupported assignment requires exactly one scope');
 const packs=new Set(scopes.map(r=>lower(r.ContentPackId)));
 const introAssignments=(snapshot.tables.PbeTrainingRecords??[]).filter(r=>seasonOwned(r)&&lower(r.OwnerId)===owner&&r.Kind==='pbe-introduction-assignment');
 const introIds=new Set(introAssignments.map(r=>JSON.parse(r.DataJson).contentPackId));
 return [
 ...rows('ScopeEntries').filter(seasonOwned).map(r=>['control','scope',lower(r.Id),lower(r.ContentPackId),{1:'Include',2:'Exclude'}[r.Kind],...range(r)]),
 ...assignments.map(r=>['control','assignment',lower(r.Id),{1:'PrimarySpecialist',2:'RequiredCoverage',3:'OptionalReview'}[r.Type]]),
 ...scopes.map(r=>['control','assignment-scope',lower(r.Id),lower(r.AssignmentId),lower(r.ContentPackId),...range(r)]),
 ...introAssignments.map(r=>['control','intro-assignment',r.Id,find('pbe-introduction-assignment',r.Id).revision,JSON.parse(r.DataJson).contentPackId]),
 ...(snapshot.tables.PbeTrainingRecords??[]).filter(r=>seasonOwned(r)&&r.Kind==='pbe-introduction'&&introIds.has(r.Id)).map(r=>['control','introduction',r.Id,find('pbe-introduction',r.Id).revision]),
 ...rows('ContentPacks').filter(r=>packs.has(lower(r.Id))).map(r=>['control','pack',lower(r.Id),lower(r.OrganizationId),!!r.IsActive,!!r.IsBuiltIn,r.LicensingStatus,{1:'Scripture',2:'Supplemental'}[r.SourceType]]),
 ...rows('CompetitionMembers').filter(r=>seasonOwned(r)&&lower(r.UserId)===owner).map(r=>['control','member',lower(r.Id),lower(r.UserId)]),
 ];
}
function groupsForSources(sources){
 const parents=new Map(),result=[];
 for(const s of sources){if(!parents.has(s.parentKey))parents.set(s.parentKey,[]);parents.get(s.parentKey).push(s);}
 for(const [key,units] of parents){
  units.sort((a,b)=>(a.verse??0)-(b.verse??0)||sort(a.id,b.id));const first=units[0],intro=first.sourceKind!=='Scripture'||first.chapter===null;
  const make=(kind,items,parentChapterKey,groupKey=key)=>{const start=items[0],end=items.at(-1),chapter=intro?null:first.chapter,firstVerse=kind==='PassageGroup'?start.verse:0;
   return {key:groupKey,parentChapterKey,kind,contentPackId:first.contentPackId,bookKey:first.bookKey,chapter,wholeChapterAssigned:kind==='Chapter'?false:null,assignedPassages:items.length,sortKey:`${first.bookKey}:${String(chapter??99999999).padStart(8,'0')}:${first.contentPackId}:${String(firstVerse).padStart(8,'0')}:${groupKey}`,label:intro?`${first.bookKey} introduction`:kind==='Chapter'?`${first.bookKey} ${chapter}`:`${first.bookKey} ${chapter}:${start.verse}${start.verse===end.verse?'':`–${end.verse}`}`,scopeLabel:intro?`${items.length} assigned introduction units`:`${items.length} assigned verses`};};
  result.push(make(intro?'Introduction':'Chapter',units,null));if(intro)continue;
  const runs=[];for(const s of units){const last=runs.at(-1);if(last&&s.verse===last.at(-1).verse+1)last.push(s);else runs.push([s]);}
  for(const run of runs){const n=Math.ceil(run.length/5),size=Math.floor(run.length/n),extra=run.length%n;let offset=0;for(let i=0;i<n;i++){const selected=run.slice(offset,offset+size+(i<extra?1:0));offset+=selected.length;result.push(make('PassageGroup',selected,key,`group:${key}:${selected[0].id}:${selected.at(-1).id}`));}}
 }
 return result.sort((a,b)=>sort(a.sortKey,b.sortKey));
}

function currentSourceIds(native,org,season,owner,scope,membership){
 const entries=scope?.data.packs??(scope?.data.contentPackId?[scope.data]:[]);
 const assignments=native.filter(r=>r.org_id===org&&r.season_id===season&&r.owner_id===owner&&r.kind==='assignment');
 const within=(unit,r)=>unit.bookKey===r.bookKey&&(unit.chapter>r.startChapter||unit.chapter===r.startChapter&&unit.verse>=r.startVerse)&&(unit.chapter<r.endChapter||unit.chapter===r.endChapter&&unit.verse<=r.endVerse);
 const selected=[];
 for(const source of native.filter(r=>r.kind==='source')){
  const pack=native.find(r=>r.kind==='pack'&&r.id===source.owner_id&&r.org_id===source.org_id);
  if(!pack||pack.org_id!==org&&pack.org_id!=='00000000-0000-4000-8000-000000000066'||!pack.data.isActive||!['development-sample','public-domain','approved','creative-commons'].includes(pack.data.licensingStatus?.toLowerCase())||!source.data.isActive||source.data.isRetired)continue;
  if(entries.some(e=>e.contentPackId===pack.id&&e.includes.some(r=>within(source.data,r))&&!e.excludes.some(r=>within(source.data,r)))&&assignments.some(a=>a.data.contentPackId===pack.id&&within(source.data,a.data)))selected.push(source.id);
 }
 const books=new Set(entries.flatMap(e=>e.includes.map(r=>r.bookKey.toUpperCase())));
 for(const intro of native.filter(r=>r.kind==='pbe-introduction'&&r.org_id===org&&r.season_id===season))if(membership&&intro.data.organizationId===org&&intro.data.seasonId===season&&intro.data.reviewed&&['approved','public-domain','creative-commons'].includes(intro.data.licensingStatus)&&books.has(intro.data.bookKey)&&native.some(a=>a.kind==='pbe-introduction-assignment'&&a.org_id===org&&a.season_id===season&&a.owner_id===owner&&a.data.contentPackId===intro.id))selected.push(...intro.data.units.map(u=>u.id));
 return [...new Set(selected)].sort();
}
