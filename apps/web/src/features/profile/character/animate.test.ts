import {describe, expect, it} from 'vitest';
import {blinkOpen, drawFrame, drawPortraitFrame, eyeWhiteExtent, playCharacterAnimation, playPortraitAnimation, portraitPoseAt, poseAt, sizeEyeMask} from './animate';
import type {CharacterLayers, Configuration} from './composition';
import type {EyeRegion} from './animate';

const config: Configuration = {
  bodyType: 'male', style: 'curls', hairColor: 'brown', attire: 'student',
  skin: 'medium', eyes: 'brown', background: 'sunrise', slots: [null, null, null],
};

describe('character idle animation', () => {
  it('starts the head at rest and loops each motion on its own period', () => {
    const start = poseAt(0);
    expect(start.bob).toBe(0);
    expect(start.gaze).toBe(0);
    for (const t of [0.7, 2.1, 5.3]) {
      expect(poseAt(t).bob).toBeCloseTo(poseAt(t+2.6).bob, 10);
    }
    expect(poseAt(1.1).gaze).toBeCloseTo(poseAt(1.1+5.3).gaze, 10);
  });

  it('keeps the figure planted with no horizontal translation', () => {
    for (let t = 0; t < 30; t += 0.13) {
      expect(Object.keys(poseAt(t)).sort()).toEqual(['bob', 'breath', 'gaze', 'sway']);
    }
  });

  it('keeps every motion subtle with no tilt or turn', () => {
    for (let t = 0; t < 30; t += 0.13) {
      const pose = poseAt(t);
      expect(Math.abs(pose.bob)).toBeLessThanOrEqual(7);
      expect(Math.abs(pose.breath)).toBeLessThanOrEqual(0.007);
      expect(Math.abs(pose.sway)).toBeLessThanOrEqual(1.7*Math.PI/180);
      expect(Math.abs(pose.gaze)).toBeLessThanOrEqual(6);
    }
  });

  it('blinks on a ~4.2s cycle with a quick close and hold', () => {
    expect(blinkOpen(0)).toBe(1);
    const closing = blinkOpen(0.045);
    expect(closing).toBeGreaterThan(0);
    expect(closing).toBeLessThan(1);
    expect(blinkOpen(0.12)).toBe(0);
    const opening = blinkOpen(0.22);
    expect(opening).toBeGreaterThan(0);
    expect(opening).toBeLessThan(1);
    expect(blinkOpen(1)).toBe(1);
    expect(blinkOpen(3.9)).toBe(1);
    expect(blinkOpen(2)).toBe(blinkOpen(2+4.2));
  });

  it('reports a friendly error when canvas 2d is unavailable', async () => {
    const errors: string[] = [];
    const stop = await playCharacterAnimation(document.createElement('canvas'), config, {onError: (message) => errors.push(message)});
    expect(errors).toEqual(['Unable to start the animated preview on this device.']);
    expect(typeof stop).toBe('function');
    stop();
  });
});

describe('animated profile portrait', () => {
  const appearance = {bodyType: 'female', style: 'curly-bob', hairColor: 'brown', skin: 'medium', eyes: 'brown'} as const;

  it('starts at rest and loops each motion on its own period', () => {
    const start = portraitPoseAt(0);
    expect(start.bob).toBe(0);
    expect(start.gaze).toBe(0);
    expect(portraitPoseAt(1.3).bob).toBeCloseTo(portraitPoseAt(1.3+2.6).bob, 10);
    expect(portraitPoseAt(2.1).gaze).toBeCloseTo(portraitPoseAt(2.1+5.3).gaze, 10);
  });

  it('has no roll or turn: only bob and gaze exist', () => {
    for (let t = 0; t < 30; t += 0.17) {
      expect(Object.keys(portraitPoseAt(t)).sort()).toEqual(['bob', 'gaze']);
    }
  });

  it('keeps the gaze subtle and the head motion small', () => {
    for (let t = 0; t < 30; t += 0.17) {
      const pose = portraitPoseAt(t);
      expect(Math.abs(pose.bob)).toBeLessThanOrEqual(2.4);
      expect(Math.abs(pose.gaze)).toBeLessThanOrEqual(6);
    }
  });

  it('moves the eyes as a plain sine sweep', () => {
    // Simple, unshaped sine: at t = 5.3/4 the gaze reaches its full ±6 peak
    // and crosses zero at the half period.
    expect(portraitPoseAt(5.3/4).gaze).toBeCloseTo(6, 8);
    expect(portraitPoseAt(3*5.3/4).gaze).toBeCloseTo(-6, 8);
    expect(portraitPoseAt(5.3/2).gaze).toBeCloseTo(0, 8);
  });

  it('reports a friendly error when canvas 2d is unavailable', async () => {
    const errors: string[] = [];
    const stop = await playPortraitAnimation(document.createElement('canvas'), appearance, {onError: (message) => errors.push(message)});
    expect(errors).toEqual(['Unable to start the animated portrait on this device.']);
    expect(typeof stop).toBe('function');
    stop();
  });

  // Minimal 2d-context stand-in that composes transforms exactly like canvas
  // (each call post-multiplies the current transform) and records where each
  // image lands. Lets the tests pin the portrait geometry without a real
  // canvas or artwork.
  function mockPortraitCtx() {
    // DOMMatrix-style {a,b,c,d,e,f}: point (x,y) -> (a*x+c*y+e, b*x+d*y+f).
    let m = {a: 1, b: 0, c: 0, d: 1, e: 0, f: 0};
    const stack: typeof m[] = [];
    const draws: {image: unknown; x: number; y: number; at: typeof m}[] = [];
    const gco: string[] = [];
    const ctx = {
      fillStyle: '', strokeStyle: '', lineWidth: 1,
      save() { stack.push({...m}); },
      restore() { m = stack.pop() ?? m; },
      clearRect() {},
      translate(x: number, y: number) { m = {a: m.a, b: m.b, c: m.c, d: m.d, e: m.e+m.a*x+m.c*y, f: m.f+m.b*x+m.d*y}; },
      scale(x: number, y: number) { m = {a: m.a*x, b: m.b*x, c: m.c*y, d: m.d*y, e: m.e, f: m.f}; },
      rotate(t: number) {
        const cos = Math.cos(t), sin = Math.sin(t);
        m = {a: m.a*cos+m.c*sin, b: m.b*cos+m.d*sin, c: m.c*cos-m.a*sin, d: m.d*cos-m.b*sin, e: m.e, f: m.f};
      },
      transform(a: number, b: number, c: number, d: number, e: number, f: number) {
        m = {a: m.a*a+m.c*b, b: m.b*a+m.d*b, c: m.a*c+m.c*d, d: m.b*c+m.d*d, e: m.e+m.a*e+m.c*f, f: m.f+m.b*e+m.d*f};
      },
      drawImage(image: unknown, ...args: number[]) { draws.push({image, x: args[0], y: args[1], at: {...m}}); },
      beginPath() {}, ellipse() {}, fill() {}, stroke() {},
      set globalCompositeOperation(v: string) { gco.push(v); },
      get globalCompositeOperation() { return 'source-over'; },
      map(at: typeof m, x: number, y: number): [number, number] {
        return [at.a*x+at.c*y+at.e, at.b*x+at.d*y+at.f];
      },
      draws,
      gco,
    };
    return ctx;
  }

  const still = {bob: 0, gaze: 0};
  const headCanvas = {} as HTMLCanvasElement;
  const crop = {extent: 423, cx: 247, cy: 260};
  // Eye-region double: the region canvas hands back its own recorder context,
  // so tests can assert the sprite shift and the mask application inside it.
  function makeEye(x: number) {
    const regionCtx = mockPortraitCtx();
    const region = {width: 84, height: 88, getContext: () => regionCtx} as unknown as HTMLCanvasElement;
    const eye = {
      sprite: {} as HTMLCanvasElement, spriteX: x-24-18, spriteY: 301-27-18,
      mask: {} as HTMLCanvasElement, region,
      ox: x-24-10, oy: 301-27-10,
    };
    return {eye, regionCtx};
  }

  it('centers the head crop on the portrait canvas', () => {
    const ctx = mockPortraitCtx();
    drawPortraitFrame(ctx as unknown as CanvasRenderingContext2D, headCanvas, crop, [], [], '#e8b98f', still, 1);
    expect(ctx.draws).toHaveLength(1);
    // The head-space crop center must land on the canvas center (160,160).
    const [x, y] = ctx.map(ctx.draws[0].at, crop.cx, crop.cy);
    expect(x).toBeCloseTo(160, 8);
    expect(y).toBeCloseTo(160, 8);
  });

  it('bobs vertically without any sideways drift', () => {
    const ctx = mockPortraitCtx();
    const pose = {bob: 2.4, gaze: 0};
    drawPortraitFrame(ctx as unknown as CanvasRenderingContext2D, headCanvas, crop, [], [], '#e8b98f', pose, 1);
    const [x, y] = ctx.map(ctx.draws[0].at, crop.cx, crop.cy);
    const s = 320/crop.extent;
    expect(x).toBeCloseTo(160, 8);
    expect(y).toBeCloseTo(160+pose.bob*s, 8);
  });

  it('moves only the eyes sideways through masked regions, never the head', () => {
    const ctx = mockPortraitCtx();
    const left = makeEye(213), right = makeEye(334);
    const pose = {bob: 0, gaze: 6};
    drawPortraitFrame(ctx as unknown as CanvasRenderingContext2D, headCanvas, crop,
      [left.eye, right.eye] as EyeRegion[], [], '#e8b98f', pose, 1);
    // The head image itself does not move sideways...
    const [hx, hy] = ctx.map(ctx.draws[0].at, crop.cx, crop.cy);
    expect(hx).toBeCloseTo(160, 8);
    expect(hy).toBeCloseTo(160, 8);
    // ...the two eye regions composite at their fixed origins...
    expect(ctx.draws).toHaveLength(3);
    expect(ctx.draws[1].image).toBe(left.eye.region);
    expect(ctx.draws[1].x).toBeCloseTo(left.eye.ox, 8);
    expect(ctx.draws[1].y).toBeCloseTo(left.eye.oy, 8);
    expect(ctx.draws[2].image).toBe(right.eye.region);
    // ...and inside each region the sprite shifts by exactly the gaze, then the
    // feathered mask is applied so the sprite rectangle can never show.
    expect(left.regionCtx.draws[0].image).toBe(left.eye.sprite);
    expect(left.regionCtx.draws[0].x).toBeCloseTo(left.eye.spriteX-left.eye.ox+pose.gaze, 8);
    expect(left.regionCtx.draws[0].y).toBeCloseTo(left.eye.spriteY-left.eye.oy, 8);
    expect(left.regionCtx.gco).toEqual(['destination-in', 'source-over']);
    expect(left.regionCtx.draws[1].image).toBe(left.eye.mask);
    expect(right.regionCtx.gco).toEqual(['destination-in', 'source-over']);
  });

  it('keeps the full-figure neck pivot planted while the eyes move', () => {
    const ctx = mockPortraitCtx();
    const neck: [number, number] = [260.5, 422];
    const layers = {
      stage: {}, head: headCanvas, body: {}, overlay: {},
      headSprite: {x: 100, y: 200, scale: 1.5},
      neck, shoulder: [512, 600] as [number, number], groundY: 1400,
    } as unknown as CharacterLayers;
    const pose = poseAt(1.7);
    // The pose vocabulary has no tilt or turn: only bob, breath, gaze, sway.
    expect('tilt' in pose).toBe(false);
    expect('yaw' in pose).toBe(false);
    const left = makeEye(213), right = makeEye(334);
    drawFrame(ctx as unknown as CanvasRenderingContext2D, layers,
      [left.eye, right.eye] as EyeRegion[], [], '#e8b98f', pose, 1);
    // The neck pivot maps to itself (plus the outer 256px stage offset):
    // bob and gaze never translate the planted figure sideways.
    const headDraw = ctx.draws.find(d => d.image === headCanvas)!;
    const [x, y] = ctx.map(headDraw.at, neck[0], neck[1]);
    expect(x).toBeCloseTo(256+neck[0], 8);
    expect(y).toBeCloseTo(neck[1]+pose.bob, 8);
    // Both eye regions are composited at their fixed origins...
    const regionDraws = ctx.draws.filter(d => d.image === left.eye.region || d.image === right.eye.region);
    expect(regionDraws).toHaveLength(2);
    // ...with each sprite repainted inside at the shifted position and the
    // feathered mask applied after, so no rectangle edge survives.
    expect(left.regionCtx.draws[0].x).toBeCloseTo(left.eye.spriteX-left.eye.ox+pose.gaze, 8);
    expect(left.regionCtx.gco).toEqual(['destination-in', 'source-over']);
    expect(left.regionCtx.draws[1].image).toBe(left.eye.mask);
  });

  it('sizes the eye mask inside the measured eye white', () => {
    // Roomy eye: opaque covers the iris at full gaze, feather ends at the outline.
    const roomy = sizeEyeMask(24, 27, 34, 37);
    expect(roomy.opaqueX).toBe(30); // rx + max gaze
    expect(roomy.opaqueY).toBe(33); // ry + max gaze
    expect(roomy.opaqueX+roomy.feather).toBeLessThanOrEqual(34);
    expect(roomy.opaqueY+roomy.feather).toBeLessThanOrEqual(37);
    expect(roomy.feather).toBeGreaterThanOrEqual(1);
    // Tight eye: the mask shrinks instead of crossing the outline.
    const tight = sizeEyeMask(24, 27, 30, 31);
    expect(tight.opaqueX+tight.feather).toBeLessThanOrEqual(30);
    expect(tight.opaqueY+tight.feather).toBeLessThanOrEqual(31);
    expect(tight.feather).toBeGreaterThanOrEqual(1);
  });

  it('measures the eye-white extent from dark outline pixels', () => {
    // Synthetic eye: bright sclera with a dark outline ring at distance 34.
    const lum = (x: number, y: number) => {
      const d = Math.hypot(x-200, y-200);
      return d >= 33.5 && d <= 34.5 ? 60 : 230;
    };
    const {ex, ey} = eyeWhiteExtent(lum, 200, 200, 24, 27);
    expect(ex).toBeCloseTo(33, 0);
    expect(ey).toBeCloseTo(33, 0);
    // No outline found: falls back to the historical ~10px sclera margin.
    const blank = eyeWhiteExtent(() => 230, 200, 200, 24, 27);
    expect(blank.ex).toBe(34);
    expect(blank.ey).toBe(37);
  });
});
