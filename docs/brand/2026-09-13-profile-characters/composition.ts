import {BodyType,HairColor,appearanceHead,headEyes,bodySources,bodyHeadRegistration} from './hair';
import {applyAppearance,paintBackground, Skin, Eyes, Background} from './appearance';
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
export async function renderCharacter(canvas: HTMLCanvasElement, config: Configuration, background: string | null = '#fffefa', quality: 'preview' | 'export' = 'preview') {
  const name = bodySources[config.bodyType][config.attire];
  const headName=`${config.bodyType}-${config.style}`;
  const extension = quality==='export' ? '.png' : '-512.webp';
  const [body, accessory, head, mask, ...patches] = await Promise.all([
    loadImage(`prepared/${name}${extension}`), loadImage(`prepared/sash${extension}`), loadImage(`heads/${headName}${quality==='export'?'.png':'.webp'}`), loadImage(`heads/${headName}-mask.png`),
    ...config.slots.map(key => {const h=honors.find(h=>h.key===key); return h ? loadImage(h.src) : Promise.resolve(null);}),
  ]);
  // Render to an offscreen buffer so asynchronous selection changes never
  // expose a half-composed character. The caller commits only its latest job.
  const buffer = document.createElement('canvas'); buffer.width=1024; buffer.height=1536;
  const ctx = buffer.getContext('2d')!;
  const reg = registration[name];
  const matrix = transform([[205,190],[795,1280]], [reg.shoulder, reg.hip]);
  const pose=bodyHeadRegistration[name],eye=headEyes[headName];
  const headScale=pose.eyes[2]/(eye[1][0]-eye[0][0]);
  const headX=pose.eyes[0]-(eye[0][0]+eye[1][0])/2*headScale;
  const headY=pose.eyes[1]-(eye[0][1]+eye[1][1])/2*headScale;
  ctx.drawImage(appearanceHead(head,mask,headName,config.skin,config.eyes,config.hairColor),headX,headY,512*headScale,512*headScale);
  const coloredBody=applyAppearance(body,name,config.skin,config.eyes);
  const scale=coloredBody.width/1024;
  ctx.drawImage(coloredBody,0,pose.cut*scale,1024*scale,(1536-pose.cut)*scale,0,pose.cut,1024,1536-pose.cut);
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
  canvas.width=1536;canvas.height=1536;const output=canvas.getContext('2d')!;
  if(background)paintBackground(output,config.background,1536,1536);
  output.drawImage(buffer,256,0);
  return canvas;
}

export function setSlot(slots: Slots, index: number, value: string | null): Slots {
  if (!Number.isInteger(index) || index<0 || index>2) throw new Error('Invalid Honor slot');
  if (value && !honors.some(h=>h.key===value)) throw new Error('Unknown review Honor');
  if (value && slots.some((s,i)=>i!==index && s===value)) throw new Error('That Honor is already displayed');
  const next: Slots=[...slots]; next[index]=value; return next;
}
