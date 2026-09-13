import {backgrounds,paintBackground} from './appearance';
import {type Configuration,loadImage,renderCharacter} from './composition';

export const cardSize={width:1200,height:1600} as const;
export type SharePatch={key:string;title:string;src:string;earnedAtUtc:string|null};
export type Placement={key:string;x:number;y:number;size:number;rotation:number};
export type ShareHistory={past:Placement[][];present:Placement[];future:Placement[][]};
export const emptyShareHistory:ShareHistory={past:[],present:[],future:[]};
export const unlockedPatches=(collection:readonly SharePatch[])=>collection.filter(p=>Boolean(p.earnedAtUtc));
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));

/** Image coordinates, independent of display size. Keep the entire rotated patch inside the card. */
export function constrainPlacement(patch:Placement):Placement{
 const size=clamp(Number.isFinite(patch.size)?patch.size:216,144,336);
 const rotation=clamp(Number.isFinite(patch.rotation)?patch.rotation:0,-180,180);
 const radians=rotation*Math.PI/180,extent=size/2*(Math.abs(Math.cos(radians))+Math.abs(Math.sin(radians)))+20;
 return {...patch,size,rotation,x:clamp(Number.isFinite(patch.x)?patch.x:600,extent,1200-extent),y:clamp(Number.isFinite(patch.y)?patch.y:800,extent,1600-extent)};
}

/** One decoration per unlocked patch; sash Honors are a separate configuration. */
export function addPlacement(current:Placement[],collection:readonly SharePatch[],key:string,point?:{x:number;y:number}):Placement[]{
 if(!unlockedPatches(collection).some(p=>p.key===key)||current.some(p=>p.key===key))return current;
 const positions=[{x:230,y:1080},{x:970,y:1250},{x:970,y:930}];
 return [...current,constrainPlacement({key,...(point??positions[current.length%positions.length]),size:216,rotation:0})];
}

export function recordShare(history:ShareHistory,next:Placement[]):ShareHistory{
 if(JSON.stringify(next)===JSON.stringify(history.present))return history;
 return {past:[...history.past,history.present].slice(-40),present:next,future:[]};
}
export function undoShare(history:ShareHistory):ShareHistory{
 if(!history.past.length)return history;
 return {past:history.past.slice(0,-1),present:history.past.at(-1)!,future:[history.present,...history.future]};
}
export function redoShare(history:ShareHistory):ShareHistory{
 if(!history.future.length)return history;
 return {past:[...history.past,history.present],present:history.future[0],future:history.future.slice(1)};
}

export async function renderShareBase(config:Configuration):Promise<HTMLCanvasElement>{
 const character=document.createElement('canvas'),backdrop=backgrounds.find(b=>b.key===config.background)!;
 const [,scene]=await Promise.all([renderCharacter(character,config,null,'export'),loadImage(backdrop.fullSrc)]);
 const canvas=document.createElement('canvas');canvas.width=cardSize.width;canvas.height=cardSize.height;const ctx=canvas.getContext('2d')!;
 paintBackground(ctx,scene,canvas.width,canvas.height);
 ctx.fillStyle=backdrop.textColor;ctx.font='600 42px system-ui';ctx.textAlign='center';
 ctx.fillText(config.attire==='coach'?'My Master Guide':'My Pathfinder',600,85);
 ctx.drawImage(character,256,0,1024,1536,130,105,940,1410);
 ctx.font='42px Georgia';ctx.fillText('Erudoza',600,1550);
 return canvas;
}

/** Shared by the live card and PNG. Editing handles never enter this canvas. */
export function paintShareCard(canvas:HTMLCanvasElement,base:HTMLCanvasElement,patches:Placement[],art:Map<string,HTMLImageElement>){
 if(canvas.width!==cardSize.width)canvas.width=cardSize.width;
 if(canvas.height!==cardSize.height)canvas.height=cardSize.height;
 const ctx=canvas.getContext('2d')!;ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(base,0,0);
 for(const raw of patches){
  const image=art.get(raw.key);if(!image)continue;
  const patch=constrainPlacement(raw);
  ctx.save();ctx.translate(patch.x,patch.y);ctx.rotate(patch.rotation*Math.PI/180);
  // Preserve each complete patch's aspect ratio, including its transparent border.
  const scale=patch.size/Math.max(image.naturalWidth,image.naturalHeight),w=image.naturalWidth*scale,h=image.naturalHeight*scale;
  ctx.shadowColor='#102e4738';ctx.shadowBlur=8;ctx.shadowOffsetY=4;ctx.drawImage(image,-w/2,-h/2,w,h);ctx.restore();
 }
}
