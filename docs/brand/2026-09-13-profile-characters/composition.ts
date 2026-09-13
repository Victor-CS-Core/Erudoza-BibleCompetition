export const styles = ['curls', 'sweep', 'bob'] as const;
export type Style = typeof styles[number];
export type Attire = 'student' | 'coach';
export type Accessory = 'sash' | 'satchel';
export const styleNames = {curls: 'Short curls', sweep: 'Side sweep', bob: 'Curly bob'};
export const honors = [
  {key: 'solo:exact-recall', title: 'Exact recall', src: '../../../apps/web/public/assets/training/exact-recall-320.webp'},
  {key: 'solo:chapter-strong', title: 'Chapter strong', src: '../../../apps/web/public/assets/training/chapter-strong-320.webp'},
  {key: 'team:first-fellowship', title: 'First fellowship', src: '../../../apps/web/public/brand/practice/first-fellowship-512.webp'},
] as const;
export type Slots = [string | null, string | null, string | null];
export type Configuration = {style: Style; attire: Attire; accessory: Accessory; slots: Slots};
type Point = [number, number];
type Registration = {shoulder: Point; hip: Point; bag: Point};
// Individually inspected attachment coordinates in each 1024 × 1536 source.
export const registration: Record<string, Registration> = {
  'student-curls': {shoulder: [352, 572], hip: [628, 900], bag: [652, 1025]},
  'student-sweep': {shoulder: [363, 595], hip: [625, 913], bag: [650, 1025]},
  'student-bob': {shoulder: [364, 606], hip: [625, 920], bag: [650, 1030]},
  'coach-curls': {shoulder: [353, 637], hip: [637, 964], bag: [661, 1082]},
  'coach-sweep': {shoulder: [355, 604], hip: [635, 926], bag: [658, 1040]},
  'coach-bob': {shoulder: [355, 609], hip: [630, 930], bag: [658, 1046]},
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
  const name = `${config.attire}-${config.style}`;
  const extension = quality==='export' ? '.png' : '-512.webp';
  const [body, accessory, ...patches] = await Promise.all([
    loadImage(`prepared/${name}${extension}`), loadImage(`prepared/${config.accessory}${extension}`),
    ...config.slots.map(key => {const h=honors.find(h=>h.key===key); return h ? loadImage(h.src) : Promise.resolve(null);}),
  ]);
  // Render to an offscreen buffer so asynchronous selection changes never
  // expose a half-composed character. The caller commits only its latest job.
  const buffer = document.createElement('canvas'); buffer.width=1024; buffer.height=1536;
  const ctx = buffer.getContext('2d')!;
  if (background) {ctx.fillStyle=background; ctx.fillRect(0,0,1024,1536);}
  const reg = registration[name];
  const from: [Point, Point] = config.accessory==='sash' ? [[205,190],[795,1280]] : [[130,125],[535,1125]];
  const matrix = transform(from, [reg.shoulder, config.accessory==='sash' ? reg.hip : reg.bag]);
  function accessoryLayer(frontOnly: boolean) {
    ctx.save(); ctx.transform(matrix.a,matrix.b,-matrix.b,matrix.a,matrix.x,matrix.y);
    if (frontOnly && config.accessory==='satchel') {
      // The rear strap passes behind the body; only the diagonal front strap
      // and bag flap are redrawn in front. Preserve the original full asset.
      const clip = new Path2D();
      clip.moveTo(65,50); clip.lineTo(170,50); clip.lineTo(920,900); clip.lineTo(910,980); clip.lineTo(790,930); clip.lineTo(85,260); clip.closePath();
      clip.rect(150,882,790,530); ctx.clip(clip);
    }
    ctx.drawImage(accessory,0,0,1024,1536); ctx.restore();
  }
  if (config.accessory==='satchel') accessoryLayer(false);
  ctx.drawImage(body,0,0,1024,1536); accessoryLayer(true);
  const centers: Point[] = config.accessory==='sash' ? [[302,404],[495,748],[691,1095]] : [[352,1030],[548,1030],[744,1030]];
  const radius = (config.accessory==='sash' ? 118 : 88)*matrix.scale;
  centers.forEach(([px,py],i)=>{
    const x=matrix.a*px-matrix.b*py+matrix.x, y=matrix.b*px+matrix.a*py+matrix.y;
    if (patches[i]) {
      ctx.save(); ctx.shadowColor='#102e4755'; ctx.shadowBlur=3; ctx.shadowOffsetY=2;
      ctx.drawImage(patches[i]!,x-radius,y-radius,radius*2,radius*2); ctx.restore();
    } else dotted(ctx,x,y,radius*.9);
  });
  canvas.width=1024;canvas.height=1536;canvas.getContext('2d')!.drawImage(buffer,0,0);
  return canvas;
}

export function setSlot(slots: Slots, index: number, value: string | null): Slots {
  if (!Number.isInteger(index) || index<0 || index>2) throw new Error('Invalid Honor slot');
  if (value && !honors.some(h=>h.key===value)) throw new Error('Unknown review Honor');
  if (value && slots.some((s,i)=>i!==index && s===value)) throw new Error('That Honor is already displayed');
  const next: Slots=[...slots]; next[index]=value; return next;
}
