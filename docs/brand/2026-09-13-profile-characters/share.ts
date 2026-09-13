import {backgrounds,paintBackground} from './appearance';
import {type Configuration,loadImage,renderCharacter} from './composition';
import landingQR from './landing-qr.json';
import type {Me} from '../../../apps/web/src/api/types';

export const cardSize={width:1200,height:1600} as const;
export type SharePatch={key:string;title:string;src:string;earnedAtUtc:string|null};
export type Placement={key:string;x:number;y:number;size:number;rotation:number};
export type ShareHistory={past:Placement[][];present:Placement[];future:Placement[][]};
export const emptyShareHistory:ShareHistory={past:[],present:[],future:[]};
export type ShareOptions={showName:boolean;showBrand:boolean;showQR:boolean};
export type ShareProfile=Readonly<Pick<Me,'userName'>>;
export const defaultShareOptions:ShareOptions={showName:true,showBrand:true,showQR:true};
export const publicLandingURL=landingQR.url;
type Rect={x:number;y:number;width:number;height:number};
export function shareFooter(options:ShareOptions):Rect|undefined{
 if(!options.showQR&&!options.showBrand)return;
 const height=options.showQR?(options.showBrand?284:240):72;
 return {x:916,y:1560-height,width:244,height};
}
export const unlockedPatches=(collection:readonly SharePatch[])=>collection.filter(p=>Boolean(p.earnedAtUtc));
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));

/** Image coordinates, independent of display size. Keep the entire rotated patch inside the card. */
export function constrainPlacement(patch:Placement,reserved?:Rect):Placement{
 const size=clamp(Number.isFinite(patch.size)?patch.size:216,144,336);
 const rotation=clamp(Number.isFinite(patch.rotation)?patch.rotation:0,-180,180);
 const radians=rotation*Math.PI/180,extent=size/2*(Math.abs(Math.cos(radians))+Math.abs(Math.sin(radians)))+20;
 const fitted={...patch,size,rotation,x:clamp(Number.isFinite(patch.x)?patch.x:600,extent,1200-extent),y:clamp(Number.isFinite(patch.y)?patch.y:800,extent,1600-extent)};
 if(reserved&&fitted.x+extent>reserved.x&&fitted.x-extent<reserved.x+reserved.width&&fitted.y+extent>reserved.y&&fitted.y-extent<reserved.y+reserved.height){
  const candidates=[{x:reserved.x-extent,y:fitted.y},{x:reserved.x+reserved.width+extent,y:fitted.y},{x:fitted.x,y:reserved.y-extent},{x:fitted.x,y:reserved.y+reserved.height+extent}]
   .filter(p=>p.x>=extent&&p.x<=1200-extent&&p.y>=extent&&p.y<=1600-extent)
   .sort((a,b)=>Math.hypot(a.x-fitted.x,a.y-fitted.y)-Math.hypot(b.x-fitted.x,b.y-fitted.y));
  if(candidates[0])return {...fitted,...candidates[0]};
 }
 return fitted;
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
 ctx.drawImage(character,256,0,1024,1536,130,105,940,1410);
 return canvas;
}

/** Shared by the live card and PNG. Editing handles never enter this canvas. */
export function paintShareCard(canvas:HTMLCanvasElement,base:HTMLCanvasElement,patches:Placement[],art:Map<string,HTMLImageElement>,profile:ShareProfile,options:ShareOptions){
 if(canvas.width!==cardSize.width)canvas.width=cardSize.width;
 if(canvas.height!==cardSize.height)canvas.height=cardSize.height;
 const ctx=canvas.getContext('2d')!;ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(base,0,0);
 for(const raw of patches){
  const image=art.get(raw.key);if(!image)continue;
  const patch=constrainPlacement(raw,shareFooter(options));
  ctx.save();ctx.translate(patch.x,patch.y);ctx.rotate(patch.rotation*Math.PI/180);
  // Preserve each complete patch's aspect ratio, including its transparent border.
  const scale=patch.size/Math.max(image.naturalWidth,image.naturalHeight),w=image.naturalWidth*scale,h=image.naturalHeight*scale;
  ctx.shadowColor='#102e4738';ctx.shadowBlur=8;ctx.shadowOffsetY=4;ctx.drawImage(image,-w/2,-h/2,w,h);ctx.restore();
 }
 const name=profile.userName.trim();
 if(options.showName&&name){
  ctx.save();ctx.fillStyle='#102e47';ctx.strokeStyle='#ffffff';ctx.lineWidth=12;ctx.lineJoin='round';ctx.textAlign='center';let fontSize=64;ctx.font=`800 ${fontSize}px system-ui`;
  while(ctx.measureText(name).width>1060&&fontSize>20){fontSize--;ctx.font=`800 ${fontSize}px system-ui`;}
  // Paint the white sticker edge beneath the lettering in both preview and export.
  ctx.shadowColor='#102e4740';ctx.shadowBlur=4;ctx.shadowOffsetY=3;ctx.strokeText(name,600,85,1060);
  ctx.shadowColor='transparent';ctx.fillText(name,600,85,1060);ctx.restore();
 }
 const footer=shareFooter(options);
 if(footer){
  // An opaque, high-contrast plate protects the QR quiet zone on every scene.
  ctx.save();ctx.fillStyle='#fffefa';ctx.beginPath();ctx.roundRect(footer.x,footer.y,footer.width,footer.height,20);ctx.fill();ctx.fillStyle='#102e47';
  if(options.showQR){
   const moduleSize=6,x=footer.x+(footer.width-landingQR.modules.length*moduleSize)/2,y=footer.y+20;
   landingQR.modules.forEach((row,dy)=>row.forEach((dark,dx)=>{if(dark)ctx.fillRect(x+dx*moduleSize,y+dy*moduleSize,moduleSize,moduleSize);}));
  }
  if(options.showBrand){ctx.font='36px Georgia';ctx.textAlign='center';ctx.fillText('Erudoza',footer.x+footer.width/2,footer.y+footer.height-24);}
  ctx.restore();
 }
}
