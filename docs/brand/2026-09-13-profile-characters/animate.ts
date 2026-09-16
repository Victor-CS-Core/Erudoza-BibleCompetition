import {headEyes} from './hair';
import {renderCharacterLayers, type CharacterLayers, type Configuration} from './composition';

export type AnimationOptions = {onError?: (message: string) => void};

/** Idle pose offsets as a pure function of seconds since the loop started. */
export function poseAt(t: number) {
  const TAU = Math.PI*2;
  return {
    /** Head vertical drift, buffer-space px. */
    bob: 7*Math.sin(TAU*t/2.6),
    /** Head tilt around the neck anchor, radians. */
    tilt: (1.4*Math.PI/180)*Math.sin(TAU*t/3.4+1.1),
    /** Body scale delta around the boot line. */
    breath: 0.007*Math.sin(TAU*t/2.6+0.5),
    /** Sash sway around the shoulder attachment, radians. */
    sway: (1.6*Math.PI/180)*Math.sin(TAU*t/3.1+2.3),
  };
}
export type Pose = ReturnType<typeof poseAt>;
const stillPose: Pose = {bob: 0, tilt: 0, breath: 0, sway: 0};

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

function drawFrame(ctx: CanvasRenderingContext2D, layers: CharacterLayers, irises: number[][], skin: string, pose: Pose, open: number) {
  ctx.clearRect(0, 0, 1536, 1536);
  // The figure stays planted: the idle loop is in-place motion only
  // (head bob/tilt, breathing, sash sway, blinking) with no translation.
  ctx.drawImage(layers.stage, 0, 0, 1536, 1536);
  ctx.save();
  ctx.translate(256, 0);
  // Head first, so the collar covers the neck exactly like the still render.
  const hs = layers.headSprite;
  ctx.save();
  ctx.translate(layers.neck[0], layers.neck[1]+pose.bob); ctx.rotate(pose.tilt);
  ctx.translate(-layers.neck[0], -layers.neck[1]);
  ctx.drawImage(layers.head, hs.x, hs.y, 512*hs.scale, 512*hs.scale);
  ctx.translate(hs.x, hs.y); ctx.scale(hs.scale, hs.scale);
  drawBlink(ctx, irises, skin, open);
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
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) {
    drawFrame(ctx, layers, irises, skin, stillPose, 1);
    return () => {};
  }
  let raf = 0, stopped = false;
  const start = performance.now();
  const frame = (now: number) => {
    if (stopped) return;
    const t = (now-start)/1000;
    drawFrame(ctx, layers, irises, skin, poseAt(t), blinkOpen(t));
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => { stopped = true; cancelAnimationFrame(raf); };
}
