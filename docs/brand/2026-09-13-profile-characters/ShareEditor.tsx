import {useEffect,useLayoutEffect,useRef,useState,type Dispatch,type SetStateAction,type PointerEvent as ReactPointerEvent} from 'react';
import {Button,Panel,Badge,Input} from '../../../apps/web/src/components/ui/index';
import {PatchArtwork} from '../../../apps/web/src/components/ui/PatchArtwork';
import {backgrounds,type Background} from './appearance';
import {type Configuration,loadImage} from './composition';
import {addPlacement,cardSize,constrainPlacement,paintShareCard,recordShare,redoShare,renderShareBase,undoShare,unlockedPatches,shareFooter,publicLandingURL,type Placement,type ShareHistory,type SharePatch,type ShareOptions,type ShareProfile} from './share';

const patchTransfer='application/x-erudoza-patch';
type Props={config:Configuration;profile:ShareProfile;collection:readonly SharePatch[];history:ShareHistory;setHistory:Dispatch<SetStateAction<ShareHistory>>;options:ShareOptions;setOptions:Dispatch<SetStateAction<ShareOptions>>;onBackground:(background:Background)=>void;onEdit:()=>void;onError:(message:string)=>void};
type Drag={pointerId:number;key:string;startX:number;startY:number;original:Placement;before:Placement[];next:Placement[];handle:HTMLButtonElement};

export function ShareEditor({config,profile,collection,history,setHistory,options,setOptions,onBackground,onEdit,onError}:Props){
 const canvasRef=useRef<HTMLCanvasElement>(null),stageRef=useRef<HTMLDivElement>(null),drag=useRef<Drag|null>(null);
 const [selected,setSelected]=useState<string|null>(null),[draft,setDraft]=useState<Placement[]|null>(null);
 const [hovering,setHovering]=useState(false),[message,setMessage]=useState(''),[exporting,setExporting]=useState(false);
 const [resources,setResources]=useState<{key:string;base:HTMLCanvasElement;art:Map<string,HTMLImageElement>}|null>(null),[drawnKey,setDrawnKey]=useState('');
 const resourceKey=JSON.stringify([config,collection]),patches=draft??history.present;
 const available=unlockedPatches(collection),footer=shareFooter(options),visible=patches.filter(p=>available.some(a=>a.key===p.key)).map(p=>constrainPlacement(p,footer));
 const renderKey=JSON.stringify([resourceKey,visible,options,profile.userName]),ready=resources?.key===resourceKey&&drawnKey===renderKey;
 const selection=visible.find(p=>p.key===selected),selectedArt=available.find(p=>p.key===selected);
 const selectedIndex=visible.findIndex(p=>p.key===selected);

 useEffect(()=>{
  let active=true;
  Promise.all([renderShareBase(config),Promise.all(unlockedPatches(collection).map(async p=>[p.key,await loadImage(p.src)] as const))]).then(([base,art])=>{
   if(active)setResources({key:resourceKey,base,art:new Map(art)});
  }).catch(e=>{if(active)onError(e instanceof Error?e.message:'Unable to prepare your card.');});
  return()=>{active=false;};
 },[resourceKey,onError]);
 useLayoutEffect(()=>{
  if(resources?.key!==resourceKey||!canvasRef.current)return;
  paintShareCard(canvasRef.current,resources.base,visible,resources.art,profile,options);setDrawnKey(renderKey);
 },[resources,resourceKey,renderKey]);
 useEffect(()=>{
  function escape(event:KeyboardEvent){if(event.key==='Escape'&&drag.current){event.preventDefault();cancelDrag();}}
  function blur(){if(drag.current)cancelDrag();}
  window.addEventListener('keydown',escape);window.addEventListener('blur',blur);
  return()=>{window.removeEventListener('keydown',escape);window.removeEventListener('blur',blur);};
 },[]);

 function commit(next:Placement[]){setHistory(h=>recordShare(h,next));setMessage('');}
 function focusPatch(key:string){requestAnimationFrame(()=>stageRef.current?.querySelector<HTMLButtonElement>(`[data-patch-key="${key}"]`)?.focus());}
 function add(key:string,point?:{x:number;y:number}){
  const next=addPlacement(history.present,collection,key,point);if(next===history.present)return;
  commit(next.map(p=>constrainPlacement(p,footer)));setSelected(key);setMessage(`${available.find(p=>p.key===key)!.title} added to your card.`);focusPatch(key);
 }
 function change(changes:Partial<Placement>){if(!selection)return;commit(history.present.map(p=>p.key===selected?constrainPlacement({...selection,...changes},footer):p));}
 function remove(){if(!selection)return;commit(history.present.filter(p=>p.key!==selected));setSelected(null);setMessage('Patch removed. You can add it again from your collection.');requestAnimationFrame(()=>document.getElementById('share-patch-tray-title')?.focus());}
 function layer(direction:number){const next=[...history.present],index=next.findIndex(p=>p.key===selected),to=index+direction;if(index<0||to<0||to>=next.length)return;[next[index],next[to]]=[next[to],next[index]];commit(next);}
 function startDrag(event:ReactPointerEvent<HTMLButtonElement>,patch:Placement){
  if(event.button!==0||drag.current)return;event.preventDefault();setSelected(patch.key);event.currentTarget.focus({preventScroll:true});event.currentTarget.setPointerCapture(event.pointerId);
  drag.current={pointerId:event.pointerId,key:patch.key,startX:event.clientX,startY:event.clientY,original:patch,before:history.present,next:history.present,handle:event.currentTarget};
 }
 function moveDrag(event:ReactPointerEvent<HTMLButtonElement>){
  const active=drag.current,rect=stageRef.current?.getBoundingClientRect();if(!active||active.pointerId!==event.pointerId||!rect)return;
  const moved=constrainPlacement({...active.original,x:active.original.x+(event.clientX-active.startX)/rect.width*cardSize.width,y:active.original.y+(event.clientY-active.startY)/rect.height*cardSize.height},footer);
  active.next=active.before.map(p=>p.key===active.key?moved:p);setDraft(active.next);
 }
 function endDrag(event:ReactPointerEvent<HTMLButtonElement>){const active=drag.current;if(!active||active.pointerId!==event.pointerId)return;drag.current=null;commit(active.next);setDraft(null);if(active.handle.hasPointerCapture(active.pointerId))active.handle.releasePointerCapture(active.pointerId);}
 function cancelDrag(){const active=drag.current;drag.current=null;setDraft(null);if(active?.handle.hasPointerCapture(active.pointerId))active.handle.releasePointerCapture(active.pointerId);}
 async function download(){
  if(!ready||!resources)return;setExporting(true);setMessage('');onError('');
  try{
   // Snapshot the same scene and placements currently shown; later edits cannot alter this download.
   const canvas=document.createElement('canvas');paintShareCard(canvas,resources.base,visible,resources.art,profile,options);
   const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Unable to create image.')),'image/png'));
   const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`erudoza-${config.style}-sash-review.png`;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);setMessage('Your card is downloaded and ready to share.');
  }catch(e){onError(e instanceof Error?e.message:'Unable to download image.');}finally{setExporting(false);}
 }

 return <div className="share-layout">
  <Panel className="share-workspace">
   <div className="share-workspace-heading"><div><span className="ds-eyebrow">Your adventure card</span><h2>A little more you.</h2></div><Badge>{visible.length} {visible.length===1?'patch':'patches'} added</Badge></div>
   <div className="share-toolbar" role="group" aria-label="Card editing tools">
    <Button variant="secondary" size="compact" disabled={!history.past.length} onClick={()=>{setHistory(undoShare);setMessage('Last edit undone.');}}><span aria-hidden="true">↶</span> Undo</Button>
    <Button variant="secondary" size="compact" disabled={!history.future.length} onClick={()=>{setHistory(redoShare);setMessage('Edit restored.');}}><span aria-hidden="true">↷</span> Redo</Button>
    <Button variant="ghost" size="compact" disabled={!visible.length} onClick={()=>{commit([]);setSelected(null);setMessage('Patches cleared. Undo restores them.');}}>Clear patches</Button>
   </div>
   <div className="share-stage-wrap">
    <div ref={stageRef} className={`share-stage${hovering?' share-stage-over':''}`} aria-label="Drop patches onto your share image" aria-describedby="share-drag-help"
     onDragOver={e=>{if(e.dataTransfer.types.includes(patchTransfer)){e.preventDefault();e.dataTransfer.dropEffect='copy';setHovering(true);}}}
     onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node|null))setHovering(false);}}
     onDrop={e=>{e.preventDefault();setHovering(false);const rect=e.currentTarget.getBoundingClientRect();add(e.dataTransfer.getData(patchTransfer),{x:(e.clientX-rect.left)/rect.width*1200,y:(e.clientY-rect.top)/rect.height*1600});}}
     onPointerDown={e=>{if(e.target===canvasRef.current)setSelected(null);}}>
     <canvas ref={canvasRef} width={1200} height={1600} className="character-canvas share-canvas" role="img" aria-label={`Share image: ${config.bodyType} ${config.attire==='coach'?'Master Guide':'Pathfinder'}, ${backgrounds.find(b=>b.key===config.background)!.name}, ${visible.length} added patches`} aria-busy={!ready} data-ready={ready}/>
     {resources?.key===resourceKey&&visible.map(patch=><Button key={patch.key} variant="ghost" className="share-patch-handle" aria-label={`Move ${available.find(p=>p.key===patch.key)!.title} patch`} aria-pressed={selected===patch.key} aria-describedby="share-keyboard-help" data-patch-key={patch.key} data-x={patch.x} data-y={patch.y} data-size={patch.size} data-rotation={patch.rotation}
      style={{left:`${patch.x/12}%`,top:`${patch.y/16}%`,width:`${patch.size/12}%`,height:`${patch.size/16}%`,transform:`translate(-50%,-50%) rotate(${patch.rotation}deg)`}}
      onFocus={()=>setSelected(patch.key)} onClick={()=>setSelected(patch.key)} onPointerDown={e=>startDrag(e,patch)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={cancelDrag} onLostPointerCapture={()=>{if(drag.current)cancelDrag();}}
      onKeyDown={e=>{if(drag.current)return;const step=e.shiftKey?24:4;const offsets:Record<string,[number,number]>={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]};if(offsets[e.key]){e.preventDefault();const [x,y]=offsets[e.key];change({x:patch.x+x,y:patch.y+y});}else if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();remove();}else if(e.key==='Escape'){setSelected(null);e.currentTarget.blur();}}}/>) }
     {!ready&&<span className="share-loading ds-badge" role="status">Preparing your card…</span>}
    </div>
   </div>
   <p id="share-drag-help" className="help share-card-caption">Drag a patch onto your card, or tap a patch to add it.</p>
   <p className="ds-caption share-card-caption">Portrait PNG · 1200 × 1600 · Ready to share</p>
  </Panel>
  <div className="editor-panels share-tools">
   <Panel className="ds-inverse-surface share-intro"><div><span className="ds-eyebrow">Made for your journey</span><h2>Collect. Create. Share.</h2><p className="ds-caption">Give your Pathfinder a card of its own with the patches you’ve earned.</p></div>{available[0]&&<PatchArtwork src={available[0].src} size={76} loading="eager"/>}</Panel>
   <Panel><h2>On your image</h2><p className="help">Choose what you share along with your Pathfinder.</p>
    <div className="share-visibility-options">{([['showName','Your username'],['showBrand','Erudoza name'],['showQR','Landing-page QR code']] as const).map(([key,label])=><Button key={key} variant="ghost" className="share-visibility-toggle" role="switch" aria-checked={options[key]} onClick={()=>setOptions(current=>({...current,[key]:!current[key]}))}><span>{label}</span><span className="share-switch-track" aria-hidden="true"/></Button>)}</div>
    <p className="ds-caption share-profile-name">Uses your profile username: <strong>{profile.userName}</strong>.</p>
    <p className="ds-caption">The QR opens <a href={publicLandingURL} target="_blank" rel="noreferrer">erudoza.com</a>. Patches stay clear of its space.</p>
   </Panel>
   <Panel><div className="share-section-heading"><h2 id="share-patch-tray-title" tabIndex={-1}>Unlocked patches</h2><Badge tone="success">{available.length} unlocked</Badge></div><p className="help">Your collection, ready for a new adventure.</p>
    <div className="share-patch-tray">{available.map(patch=>{const placed=visible.some(p=>p.key===patch.key);return <Button key={patch.key} variant="secondary" disabled={placed} draggable={!placed} aria-label={`Add ${patch.title} patch`} onDragStart={e=>{e.dataTransfer.setData(patchTransfer,patch.key);e.dataTransfer.effectAllowed='copy';const image=e.currentTarget.querySelector('img');if(image)e.dataTransfer.setDragImage(image,image.clientWidth/2,image.clientHeight/2);}} onDragEnd={()=>setHovering(false)} onClick={()=>add(patch.key)}><PatchArtwork src={patch.src} size={88} loading="eager"/><span>{patch.title}</span><span className="ds-caption">{placed?'On your card':'+ Add to card'}</span></Button>;})}</div>
    {!available.length&&<p className="help">Your unlocked patches will appear here as you earn them.</p>}
    <p className="ds-caption">Sample unlocks for this design preview.</p>
   </Panel>
   <Panel className="share-adjust"><div className="share-section-heading"><h2>Patch tools</h2>{selection&&<Badge>Selected</Badge>}</div>
    {selection&&selectedArt?<><div className="share-selection"><PatchArtwork src={selectedArt.src} size={52} loading="eager"/><div><h3>{selectedArt.title}</h3><p className="ds-caption">Drag it into place, then make it your own.</p></div></div>
     <div className="share-sliders"><label><span>Size <output>{Math.round(selection.size/12)}%</output></span><Input type="range" aria-label="Patch size" min={12} max={28} step={1} value={selection.size/12} onChange={e=>change({size:Number(e.target.value)*12})}/></label><label><span>Rotation <output>{selection.rotation}°</output></span><Input type="range" aria-label="Patch rotation" min={-180} max={180} step={5} value={selection.rotation} onChange={e=>change({rotation:Number(e.target.value)})}/></label></div>
     <div className="share-layer-tools"><Button variant="secondary" size="compact" disabled={selectedIndex===visible.length-1} onClick={()=>layer(1)}>Bring forward</Button><Button variant="secondary" size="compact" disabled={selectedIndex===0} onClick={()=>layer(-1)}>Send backward</Button><Button variant="ghost" size="compact" onClick={()=>change({size:216,rotation:0})}>Reset size & tilt</Button><Button variant="danger" size="compact" onClick={remove}>Remove patch</Button></div>
    </>:<p className="help">Add a patch or select one on your card to resize, rotate or layer it.</p>}
    <p id="share-keyboard-help" className="ds-caption">Keyboard: use arrow keys to move a selected patch. Hold Shift for bigger steps. Delete removes it.</p>
   </Panel>
   <Panel><h2>Set the scene</h2><div className="background-options share-backgrounds">{backgrounds.map(b=><Button key={b.key} variant={config.background===b.key?'primary':'secondary'} aria-pressed={config.background===b.key} onClick={()=>onBackground(b.key)}><img src={b.thumbnail} alt=""/>{b.name}</Button>)}</div></Panel>
   <Panel><Button className="wide-action" disabled={exporting||!ready} onClick={download}>{exporting?'Preparing image…':'Download review image'}</Button><Button variant="ghost" className="wide-action" onClick={onEdit}>Edit character</Button><p className="help">Card decorations don’t change your profile image or the three Honors on your sash.</p><p className="share-status help" role="status" aria-live="polite">{message}</p></Panel>
  </div>
 </div>;
}
