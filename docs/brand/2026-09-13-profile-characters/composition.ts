import {BodyType,HairColor,appearanceHead,headPlacement,headAnchors,bodySources,bodyFrame,characterTopInset} from './hair';
import {applyAppearance,paintBackground,paintGroundShadow,backgrounds, Skin, Eyes, Background} from './appearance';
export type Attire = 'student' | 'coach';
export const honors = [
  {key: 'solo:exact-recall', title: 'Exact recall', src: '../../../apps/web/public/assets/training/exact-recall-320.webp'},
  {key: 'solo:chapter-strong', title: 'Chapter strong', src: '../../../apps/web/public/assets/training/chapter-strong-320.webp'},
  {key: 'team:first-fellowship', title: 'First fellowship', src: '../../../apps/web/public/brand/practice/first-fellowship-512.webp'},
] as const;
export type Slots = [string | null, string | null, string | null];
export type Configuration = {bodyType: BodyType; style: string; hairColor: HairColor; attire: Attire; skin: Skin; eyes: Eyes; background: Background; slots: Slots};
type Point = [number, number];
type Registration = {shoulder: Point; hip: Point};
// Individually inspected attachment coordinates in each 1024 × 1536 source.
// Screen coordinates: upper-left shoulder to lower-right hip, for both bodies
// and both attires. Never mirror the character or Honor artwork to change fit.
export const registration: Record<string, Registration> = {
  'student-curls': {shoulder: [352, 572], hip: [628, 900]},
  'student-sweep': {shoulder: [363, 595], hip: [625, 913]},
  'student-bob': {shoulder: [364, 606], hip: [625, 920]},
  'coach-curls': {shoulder: [353, 637], hip: [637, 964]},
  'coach-sweep': {shoulder: [355, 604], hip: [635, 926]},
  'coach-bob': {shoulder: [355, 609], hip: [630, 930]},
};
const images = new Map<string, Promise<HTMLImageElement>>();
export function loadImage(src: string) {
  let task = images.get(src);
  if (!task) {
    task = new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => { images.delete(src); reject(new Error('Unable to load artwork. Please reload this review.')); };
      image.src = src;
    });
    images.set(src, task);
  }
  return task;
}
function honorPatch(key: string | null) {
  const h=honors.find(h=>h.key===key); return h ? loadImage(h.src) : Promise.resolve(null);
}
function transform(from: [Point, Point], to: [Point, Point]) {
  const [p, q] = from, [r, s] = to;
  const ux = q[0]-p[0], uy = q[1]-p[1], vx = s[0]-r[0], vy = s[1]-r[1];
  const denominator = ux*ux+uy*uy;
  const a = (vx*ux+vy*uy)/denominator, b = (vy*ux-vx*uy)/denominator;
  return {a, b, x: r[0]-a*p[0]+b*p[1], y: r[1]-b*p[0]-a*p[1], scale: Math.hypot(a,b)};
}
function dotted(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  ctx.fillStyle = '#f3eddf';
  for (let dot=0; dot<28; dot++) {
    const angle = dot*Math.PI*2/28;
    ctx.beginPath(); ctx.arc(x+Math.cos(angle)*radius, y+Math.sin(angle)*radius, Math.max(1.4,radius*.034), 0, Math.PI*2); ctx.fill();
  }
}
async function loadCharacterAssets(config: Configuration, background: string | null, quality: 'preview' | 'export') {
  const name = bodySources[config.bodyType][config.attire];
  const headName=`${config.bodyType}-${config.style}`;
  const extension = quality==='export' ? '.png' : '-512.webp';
  const backdrop=backgrounds.find(b=>b.key===config.background)!;
  const [body, garment, accessory, head, mask, scene, ...patches] = await Promise.all([
    loadImage(`prepared/${name}${extension}`), loadImage(`body-layers/${name}${quality==='export'?'.png':'.webp'}`), loadImage(`prepared/sash${extension}`), loadImage(`heads/${headName}${quality==='export'?'.png':'.webp'}`), loadImage(`heads/${headName}-mask.png`),
    background?loadImage(quality==='export'?backdrop.fullSrc:backdrop.src):Promise.resolve(null),
    ...config.slots.map(honorPatch),
  ]);
  return {name,headName,body,garment,accessory,head,mask,scene,patches};
}
export async function renderCharacter(canvas: HTMLCanvasElement, config: Configuration, background: string | null = '#fffefa', quality: 'preview' | 'export' = 'preview') {
  const {name,headName,body,garment,accessory,head,mask,scene,patches} = await loadCharacterAssets(config, background, quality);
  // Render to an offscreen buffer so asynchronous selection changes never
  // expose a half-composed character. The caller commits only its latest job.
  const buffer = document.createElement('canvas'); buffer.width=1024; buffer.height=1536;
  const ctx = buffer.getContext('2d')!;
  const reg = registration[name];
  const matrix = transform([[205,190],[795,1280]], [reg.shoulder, reg.hip]);
  const frame=bodyFrame(name),placement=headPlacement(headName,frame.reference);
  ctx.drawImage(appearanceHead(head,mask,headName,config.skin,config.eyes,config.hairColor),placement.x,placement.y+characterTopInset,512*placement.scale,512*placement.scale);
  // Normalize the garment, sash and its Honors together without stretching.
  ctx.save();ctx.transform(frame.scale,0,0,frame.scale,frame.x,frame.y);
  const coloredBody=applyAppearance(body,name,config.skin,config.eyes);
  const bodyContext=coloredBody.getContext('2d')!;bodyContext.globalCompositeOperation='destination-in';
  bodyContext.drawImage(garment,0,0,coloredBody.width,coloredBody.height);
  bodyContext.globalCompositeOperation='source-over';ctx.drawImage(coloredBody,0,0,1024,1536);
  ctx.save(); ctx.transform(matrix.a,matrix.b,-matrix.b,matrix.a,matrix.x,matrix.y);
  ctx.drawImage(accessory,0,0,1024,1536); ctx.restore();
  const centers: Point[] = [[282,393],[516,720],[741,1048]];
  const radius = 145*matrix.scale;
  centers.forEach(([px,py],i)=>{
    const x=matrix.a*px-matrix.b*py+matrix.x, y=matrix.b*px+matrix.a*py+matrix.y;
    if (patches[i]) {
      ctx.save(); ctx.shadowColor='#102e4755'; ctx.shadowBlur=3; ctx.shadowOffsetY=2;
      ctx.drawImage(patches[i]!,x-radius,y-radius,radius*2,radius*2); ctx.restore();
    } else dotted(ctx,x,y,radius*.9);
  });
  ctx.restore();
  canvas.width=1536;canvas.height=1536;const output=canvas.getContext('2d')!;
  if(scene)paintBackground(output,scene,1536,1536);
  // Ground contact follows the measured boot bottoms in each body source.
  paintGroundShadow(output,768,frame.groundY-2,225);
  output.drawImage(buffer,256,0);
  return canvas;
}

export function setSlot(slots: Slots, index: number, value: string | null): Slots {
  if (!Number.isInteger(index) || index<0 || index>2) throw new Error('Invalid Honor slot');
  if (value && !honors.some(h=>h.key===value)) throw new Error('Unknown review Honor');
  if (value && slots.some((s,i)=>i!==index && s===value)) throw new Error('That Honor is already displayed');
  const next: Slots=[...slots]; next[index]=value; return next;
}

// The avatar is drawn directly from the head layer. It never samples the
// character stage, garment, background, or ground shadow.
export async function renderPortrait(canvas:HTMLCanvasElement,config:Configuration){
 const name=`${config.bodyType}-${config.style}`;
 const [head,mask]=await Promise.all([loadImage(`heads/${name}.png`),loadImage(`heads/${name}-mask.png`)]);
 const colored=appearanceHead(head,mask,name,config.skin,config.eyes,config.hairColor);
 const pixels=colored.getContext('2d')!.getImageData(0,0,512,512).data;
 let left=512,top=512,right=0,bottom=0;
 for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>8){const x=i/4%512,y=Math.floor(i/4/512);left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
 const extent=Math.max(right-left+1,bottom-top+1)+28,cx=(left+right)/2,cy=(top+bottom)/2;
 canvas.width=320;canvas.height=320;
 canvas.getContext('2d')!.drawImage(colored,cx-extent/2,cy-extent/2,extent,extent,0,0,320,320);
 return canvas;
}

// Layered render for the animated preview. The layers hold the same pixels
// renderCharacter composes, split so the animator can move them independently:
// the stage never moves, the head bobs and tilts on its neck anchor, the body
// breathes around the feet, and the sash sways on its shoulder attachment.
export type CharacterLayers = {
  /** 1536x1536 painted background plus ground shadow. */
  stage: HTMLCanvasElement;
  /** 1024x1536 frame-normalized, garment-masked body (no head). */
  body: HTMLCanvasElement;
  /** 1024x1536 sash plus Honor patches (or dotted spots) in buffer space. */
  overlay: HTMLCanvasElement;
  /** 512x512 recolored head sprite, unplaced. */
  head: HTMLCanvasElement;
  /** Head placement in 1024x1536 buffer space. */
  headSprite: {x: number; y: number; scale: number};
  /** Neck pivot in buffer space (head tilt anchor). */
  neck: [number, number];
  /** Sash shoulder attachment in buffer space (sway anchor). */
  shoulder: [number, number];
  /** Boot bottoms in buffer space (breathing anchor). */
  groundY: number;
};
export async function renderCharacterLayers(config: Configuration, background: string | null = '#fffefa'): Promise<CharacterLayers> {
  const {name,headName,body,garment,accessory,head,mask,scene,patches} = await loadCharacterAssets(config, background, 'preview');
  const reg = registration[name];
  const matrix = transform([[205,190],[795,1280]], [reg.shoulder, reg.hip]);
  const frame = bodyFrame(name), placement = headPlacement(headName, frame.reference);
  const headSprite = {x: placement.x, y: placement.y + characterTopInset, scale: placement.scale};
  const anchor = headAnchors[headName].neck;
  const neck: [number, number] = [headSprite.x + anchor[0]*headSprite.scale, headSprite.y + anchor[1]*headSprite.scale];
  // Frame-normalized, garment-masked body.
  const bodyLayer = document.createElement('canvas'); bodyLayer.width=1024; bodyLayer.height=1536;
  const bodyCtx = bodyLayer.getContext('2d')!;
  bodyCtx.transform(frame.scale,0,0,frame.scale,frame.x,frame.y);
  const coloredBody=applyAppearance(body,name,config.skin,config.eyes);
  const bodyContext=coloredBody.getContext('2d')!;bodyContext.globalCompositeOperation='destination-in';
  bodyContext.drawImage(garment,0,0,coloredBody.width,coloredBody.height);
  bodyContext.globalCompositeOperation='source-over';bodyCtx.drawImage(coloredBody,0,0,1024,1536);
  // Sash and Honors in buffer space, drawn with the same frame+matrix pair.
  const overlay = document.createElement('canvas'); overlay.width=1024; overlay.height=1536;
  const overlayCtx = overlay.getContext('2d')!;
  overlayCtx.transform(frame.scale,0,0,frame.scale,frame.x,frame.y);
  overlayCtx.save(); overlayCtx.transform(matrix.a,matrix.b,-matrix.b,matrix.a,matrix.x,matrix.y);
  overlayCtx.drawImage(accessory,0,0,1024,1536); overlayCtx.restore();
  const centers: Point[] = [[282,393],[516,720],[741,1048]];
  const radius = 145*matrix.scale;
  centers.forEach(([px,py],i)=>{
    const x=matrix.a*px-matrix.b*py+matrix.x, y=matrix.b*px+matrix.a*py+matrix.y;
    if (patches[i]) {
      overlayCtx.save(); overlayCtx.shadowColor='#102e4755'; overlayCtx.shadowBlur=3; overlayCtx.shadowOffsetY=2;
      overlayCtx.drawImage(patches[i]!,x-radius,y-radius,radius*2,radius*2); overlayCtx.restore();
    } else dotted(overlayCtx,x,y,radius*.9);
  });
  // Stage: background plus ground shadow.
  const stage = document.createElement('canvas'); stage.width=1536; stage.height=1536;
  const stageCtx = stage.getContext('2d')!;
  if(scene)paintBackground(stageCtx,scene,1536,1536);
  paintGroundShadow(stageCtx,768,frame.groundY-2,225);
  return {
    stage, body: bodyLayer, overlay,
    head: appearanceHead(head,mask,headName,config.skin,config.eyes,config.hairColor),
    headSprite, neck,
    shoulder: [frame.scale*reg.shoulder[0]+frame.x, frame.scale*reg.shoulder[1]+frame.y],
    groundY: frame.groundY,
  };
}
