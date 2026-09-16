import {headEyes} from './hair';
import {renderCharacterLayers,portraitHead,type CharacterLayers,type Configuration,type PortraitConfig,type PortraitHead} from './composition';

export type AnimationOptions = {onError?: (message: string) => void};

/** Maximum horizontal iris travel, 512px head-space px. Shared by pose and mask sizing. */
const GAZE_MAX = 6;

/** Idle pose offsets as a pure function of seconds since the loop started. */
export function poseAt(t: number) {
  const TAU = Math.PI*2;
  return {
    /** Head vertical drift, buffer-space px. */
    bob: 7*Math.sin(TAU*t/2.6),
    /** Body scale delta around the boot line. */
    breath: 0.007*Math.sin(TAU*t/2.6+0.5),
    /** Sash sway around the shoulder attachment, radians. */
    sway: (1.6*Math.PI/180)*Math.sin(TAU*t/3.1+2.3),
    /** Simple eye movement: the irises shift side to side, 512px head-space px. */
    gaze: GAZE_MAX*Math.sin(TAU*t/5.3),
  };
}
export type Pose = ReturnType<typeof poseAt>;
const stillPose: Pose = {bob: 0, breath: 0, sway: 0, gaze: 0};

/** Blink openness 0..1 as a pure function of seconds. Blinks every ~4.2s. */
export function blinkOpen(t: number): number {
  const at = t%4.2;
  if (at < 0.09) { const k = at/0.09; return 1-k*k; }
  if (at < 0.15) return 0;
  if (at < 0.29) { const k = (at-0.15)/0.14; return k*k; }
  return 1;
}

// Skin tone for the procedural eyelids, sampled from the recolored head's
// forehead band (the same region appearanceHead trusts for skin reference).
function lidColor(head: HTMLCanvasElement, irises: number[][]): string {
  const ctx = head.getContext('2d');
  if (!ctx) return '#e8b98f';
  const cx = (irises[0][0]+irises[1][0])/2, cy = (irises[0][1]+irises[1][1])/2;
  const unit = (irises[1][0]-irises[0][0])/120;
  const x0 = Math.round(cx-30*unit), y0 = Math.round(cy-92*unit);
  const w = Math.round(60*unit), h = Math.round(37*unit);
  const data = ctx.getImageData(Math.max(0,x0), Math.max(0,y0), w, h).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i+3] > 200) { r += data[i]; g += data[i+1]; b += data[i+2]; n++; }
  }
  if (!n) return '#e8b98f';
  return `rgb(${Math.round(r/n)},${Math.round(g/n)},${Math.round(b/n)})`;
}

// Lids are drawn in 512px head-sprite space, over the iris ellipses, growing
// down from the top of each eye as it closes.
function drawBlink(ctx: CanvasRenderingContext2D, irises: number[][], color: string, open: number) {
  if (open > 0.985) return;
  ctx.save();
  ctx.fillStyle = color;
  for (const [cx, cy, rx, ry] of irises) {
    const cover = 1-open, lidHeight = ry*2*cover;
    ctx.beginPath();
    ctx.ellipse(cx, cy-ry+lidHeight/2, rx*1.04, Math.max(lidHeight/2, 0.6), 0, 0, Math.PI*2);
    ctx.fill();
    if (cover > 0.35) {
      ctx.strokeStyle = 'rgba(60,38,28,0.85)'; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.ellipse(cx, cy-ry+lidHeight, rx*1.02, 2.2, 0, 0, Math.PI); ctx.stroke();
    }
  }
  ctx.restore();
}

/** Draw one animated character frame. Exported for regression tests. */
export function drawFrame(
  ctx: CanvasRenderingContext2D, layers: CharacterLayers,
  eyes: EyeRegion[], irises: number[][], skin: string, pose: Pose, open: number,
) {
  ctx.clearRect(0, 0, 1536, 1536);
  // The figure stays planted: the idle loop is in-place motion only
  // (head bob, eye movement, breathing, sash sway, blinking) with no translation.
  ctx.drawImage(layers.stage, 0, 0, 1536, 1536);
  ctx.save();
  ctx.translate(256, 0);
  // Head first, so the collar covers the neck exactly like the still render.
  const hs = layers.headSprite;
  ctx.save();
  // The head bobs vertically on the neck anchor; the bob stays vertical and
  // the head never turns or translates sideways.
  ctx.translate(layers.neck[0], layers.neck[1]+pose.bob);
  ctx.translate(-layers.neck[0], -layers.neck[1]);
  ctx.drawImage(layers.head, hs.x, hs.y, 512*hs.scale, 512*hs.scale);
  ctx.translate(hs.x, hs.y); ctx.scale(hs.scale, hs.scale);
  // The glance repaints each eye through its feathered eye-white mask at the
  // shifted position. The sprite's sclera margin covers the iris's old spot,
  // the head underneath was repainted fresh this frame, and the mask — never
  // the sprite rectangle — defines the visible edge, so the shift is seamless.
  eyes.forEach((eye, i) => drawEye(ctx, eye, irises[i], pose.gaze, skin, open));
  ctx.restore();
  // Body breathes around the boot line; the sash rides the same motion and
  // sways on its shoulder attachment.
  ctx.save();
  ctx.translate(512, layers.groundY); ctx.scale(1, 1+pose.breath); ctx.translate(-512, -layers.groundY);
  ctx.drawImage(layers.body, 0, 0, 1024, 1536);
  ctx.save();
  ctx.translate(layers.shoulder[0], layers.shoulder[1]); ctx.rotate(pose.sway);
  ctx.translate(-layers.shoulder[0], -layers.shoulder[1]);
  ctx.drawImage(layers.overlay, 0, 0, 1024, 1536);
  ctx.restore();
  ctx.restore();
  ctx.restore();
}

/**
 * Play the idle animation for a character configuration on a canvas. Resolves
 * to a stop function; the loop ends when it is called or the canvas is gone.
 * Honors prefers-reduced-motion with a single still frame.
 */
export async function playCharacterAnimation(
  canvas: HTMLCanvasElement,
  config: Configuration,
  options: AnimationOptions = {},
): Promise<() => void> {
  const ctx = canvas.getContext('2d');
  if (!ctx) { options.onError?.('Unable to start the animated preview on this device.'); return () => {}; }
  let layers: CharacterLayers;
  try {
    layers = await renderCharacterLayers(config);
  } catch {
    options.onError?.('Unable to load your animated character. Please try again.');
    return () => {};
  }
  canvas.width = 1536; canvas.height = 1536;
  const irises = headEyes[`${config.bodyType}-${config.style}`];
  const skin = lidColor(layers.head, irises);
  const sprites = eyeRegions(layers.head, irises);
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) {
    drawFrame(ctx, layers, sprites, irises, skin, stillPose, 1);
    return () => {};
  }
  let raf = 0, stopped = false;
  const start = performance.now();
  const frame = (now: number) => {
    if (stopped) return;
    const t = (now-start)/1000;
    drawFrame(ctx, layers, sprites, irises, skin, poseAt(t), blinkOpen(t));
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => { stopped = true; cancelAnimationFrame(raf); };
}

/** Idle portrait pose as a pure function of seconds since the loop started. */
export function portraitPoseAt(t: number) {
  const TAU = Math.PI*2;
  return {
    /** Head vertical drift, 512px head-space px. The head never translates sideways. */
    bob: 2.4*Math.sin(TAU*t/2.6),
    /** Simple eye movement: the irises shift side to side, 512px head-space px. */
    gaze: GAZE_MAX*Math.sin(TAU*t/5.3),
  };
}
export type PortraitPose = ReturnType<typeof portraitPoseAt>;
const stillPortraitPose: PortraitPose = {bob: 0, gaze: 0};

export type EyeRegion = {
  /** Snipped iris + wide sclera margin; drawn at (spriteX+gaze, spriteY). */
  sprite: HTMLCanvasElement; spriteX: number; spriteY: number;
  /** Feathered eye-white mask (alpha only); defines the visible edge. */
  mask: HTMLCanvasElement;
  /** Reusable per-frame composition canvas, sized to the mask. */
  region: HTMLCanvasElement;
  /** Region origin in head space. */
  ox: number; oy: number;
};

/**
 * Measure the eye-white extent from the artwork: march outward from just past
 * the iris edge along each axis until the dark lid outline is hit. Falls back
 * to the historical ~10px sclera margin when no outline is found. Exported
 * for the visual harness.
 */
export function eyeWhiteExtent(
  lum: (x: number, y: number) => number,
  x: number, y: number, rx: number, ry: number,
): {ex: number; ey: number} {
  const march = (dx: number, dy: number, r: number): number => {
    for (let d = r+3; d <= r+24; d += 1) {
      if (lum(x+dx*d, y+dy*d) < 100) return Math.max(r+4, d-1);
    }
    return r+10;
  };
  return {
    ex: Math.min(march(1, 0, rx), march(-1, 0, rx)),
    ey: Math.min(march(0, 1, ry), march(0, -1, ry)),
  };
}

/**
 * Size the mask's opaque ellipse + feather band so the iris stays fully
 * opaque at maximum gaze while the feather never crosses the lid outline.
 * Exported for regression tests.
 */
export function sizeEyeMask(rx: number, ry: number, exWhite: number, eyWhite: number) {
  const opaqueX = Math.max(rx+1, Math.min(rx+GAZE_MAX, exWhite-4));
  const opaqueY = Math.max(ry+1, Math.min(ry+GAZE_MAX, eyWhite-4));
  const feather = Math.max(1, Math.min(4, exWhite-opaqueX-0.5, eyWhite-opaqueY-0.5));
  return {opaqueX, opaqueY, feather};
}

// Elliptical alpha mask: fully opaque over the iris travel zone, feathered to
// transparent before the lid outline. Only alpha matters (destination-in).
function featheredEyeMask(opaqueX: number, opaqueY: number, feather: number): HTMLCanvasElement {
  const w = Math.ceil(2*(opaqueX+feather)), h = Math.ceil(2*(opaqueY+feather));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const m = canvas.getContext('2d')!;
  m.translate(w/2, h/2);
  m.scale(opaqueX+feather, opaqueY+feather);
  const inner = Math.min(opaqueX/(opaqueX+feather), opaqueY/(opaqueY+feather));
  const g = m.createRadialGradient(0, 0, 0, 0, 0, 1);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(inner, 'rgba(0,0,0,1)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  m.fillStyle = g;
  m.fillRect(-1, -1, 2, 2);
  return canvas;
}

// Snip each iris out of the recolored head so the glance can move the irises
// inside the eye whites. The sprite carries a wide sclera margin (past the
// maximum glance in either direction, and past the mask's feather band) so the
// shifted sprite covers the iris's old position while its own rectangle edge
// always lands outside the feathered eye mask — the mask, not the rectangle,
// defines the visible edge. Exported for the visual harness.
export function eyeRegions(head: HTMLCanvasElement, irises: number[][]): EyeRegion[] {
  const hctx = head.getContext('2d')!;
  return irises.map(([x, y, rx, ry]) => {
    const pad = 18, w = Math.ceil(rx*2+pad*2), h = Math.ceil(ry*2+pad*2);
    const sprite = document.createElement('canvas');
    sprite.width = w; sprite.height = h;
    const spriteX = x-rx-pad, spriteY = y-ry-pad;
    sprite.getContext('2d')!.drawImage(head, spriteX, spriteY, w, h, 0, 0, w, h);
    // Sample the eye neighborhood once, then measure the real eye-white shape.
    const bx0 = Math.max(0, Math.floor(x-rx-26)), by0 = Math.max(0, Math.floor(y-ry-26));
    const bw = Math.ceil(rx*2+52), bh = Math.ceil(ry*2+52);
    const data = hctx.getImageData(bx0, by0, bw, bh).data;
    const lum = (px: number, py: number): number => {
      const ix = Math.max(0, Math.min(bw-1, Math.round(px-bx0)));
      const iy = Math.max(0, Math.min(bh-1, Math.round(py-by0)));
      const i = (iy*bw+ix)*4;
      return 0.299*data[i]+0.587*data[i+1]+0.114*data[i+2];
    };
    const {ex, ey} = eyeWhiteExtent(lum, x, y, rx, ry);
    const {opaqueX, opaqueY, feather} = sizeEyeMask(rx, ry, ex, ey);
    const mask = featheredEyeMask(opaqueX, opaqueY, feather);
    const region = document.createElement('canvas');
    region.width = mask.width; region.height = mask.height;
    return {sprite, spriteX, spriteY, mask, region, ox: x-opaqueX-feather, oy: y-opaqueY-feather};
  });
}

// Repaint one eye's shifted iris plus its blink lid through the feathered
// eye-white mask, so the moving content can never show a rectangular seam.
function drawEye(
  ctx: CanvasRenderingContext2D, eye: EyeRegion, iris: number[],
  gaze: number, skin: string, open: number,
) {
  const r = eye.region.getContext('2d')!;
  r.clearRect(0, 0, eye.region.width, eye.region.height);
  r.drawImage(eye.sprite, eye.spriteX-eye.ox+gaze, eye.spriteY-eye.oy);
  // Blink lids follow the glance; positioned in head space via the region offset.
  r.save();
  r.translate(-eye.ox+gaze, -eye.oy);
  drawBlink(r, [iris], skin, open);
  r.restore();
  r.globalCompositeOperation = 'destination-in';
  r.drawImage(eye.mask, 0, 0);
  r.globalCompositeOperation = 'source-over';
  ctx.drawImage(eye.region, eye.ox, eye.oy);
}

const PORTRAIT_PX = 320;

/** Draw one animated portrait frame. Exported for regression tests. */
export function drawPortraitFrame(
  ctx: CanvasRenderingContext2D, head: HTMLCanvasElement,
  crop: {extent: number; cx: number; cy: number},
  eyes: EyeRegion[], irises: number[][], skin: string,
  pose: PortraitPose, open: number,
) {
  ctx.clearRect(0, 0, PORTRAIT_PX, PORTRAIT_PX);
  const s = PORTRAIT_PX/crop.extent;
  ctx.save();
  // Center the head crop on the canvas, then apply in-place motion only: a
  // vertical bob. The head never turns or translates sideways. The bob is
  // measured in head-space px, so scale it into canvas px here. (Translating
  // by the crop center before the scale would shove the head off the canvas.)
  ctx.translate(PORTRAIT_PX/2, PORTRAIT_PX/2+pose.bob*s);
  ctx.scale(s, s);
  ctx.translate(-crop.cx, -crop.cy);
  ctx.drawImage(head, 0, 0);
  // The glance repaints each eye through its feathered eye-white mask; see
  // drawFrame for why the mask — never the sprite rectangle — is the edge.
  eyes.forEach((eye, i) => drawEye(ctx, eye, irises[i], pose.gaze, skin, open));
  ctx.restore();
}

/**
 * Play the idle portrait animation for a character appearance on a canvas.
 * The head bobs and blinks with simple side-to-side eye movement while
 * staying planted: nothing turns or translates sideways.
 * Resolves to a stop function; the loop ends when it is called or the canvas
 * is gone. Honors prefers-reduced-motion with a single still frame.
 */
export async function playPortraitAnimation(
  canvas: HTMLCanvasElement,
  appearance: PortraitConfig,
  options: AnimationOptions = {},
): Promise<() => void> {
  const ctx = canvas.getContext('2d');
  if (!ctx) { options.onError?.('Unable to start the animated portrait on this device.'); return () => {}; }
  let prep: PortraitHead;
  try {
    prep = await portraitHead(appearance);
  } catch {
    options.onError?.('Unable to load your portrait. Please try again.');
    return () => {};
  }
  canvas.width = PORTRAIT_PX; canvas.height = PORTRAIT_PX;
  const irises = headEyes[`${appearance.bodyType}-${appearance.style}`] ?? [];
  const skin = irises.length ? lidColor(prep.head, irises) : '#e8b98f';
  const sprites = eyeRegions(prep.head, irises);
  const crop = {extent: prep.extent, cx: prep.cx, cy: prep.cy};
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) {
    drawPortraitFrame(ctx, prep.head, crop, sprites, irises, skin, stillPortraitPose, 1);
    return () => {};
  }
  let raf = 0, stopped = false;
  const start = performance.now();
  const frame = (now: number) => {
    if (stopped || !canvas.isConnected) return;
    const t = (now-start)/1000;
    drawPortraitFrame(ctx, prep.head, crop, sprites, irises, skin, portraitPoseAt(t), blinkOpen(t));
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => { stopped = true; cancelAnimationFrame(raf); };
}
