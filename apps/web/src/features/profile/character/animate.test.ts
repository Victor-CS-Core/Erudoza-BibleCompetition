import {describe, expect, it} from 'vitest';
import {blinkOpen, drawPortraitFrame, playCharacterAnimation, playPortraitAnimation, portraitPoseAt, poseAt} from './animate';
import type {Configuration} from './composition';

const config: Configuration = {
  bodyType: 'male', style: 'curls', hairColor: 'brown', attire: 'student',
  skin: 'medium', eyes: 'brown', background: 'sunrise', slots: [null, null, null],
};

describe('character idle animation', () => {
  it('starts the head at rest and loops each motion on its own period', () => {
    const start = poseAt(0);
    expect(start.bob).toBe(0);
    expect(start.tilt).toBeCloseTo((1.4*Math.PI/180)*Math.sin(1.1), 10);
    for (const t of [0.7, 2.1, 5.3]) {
      expect(poseAt(t).bob).toBeCloseTo(poseAt(t+2.6).bob, 10);
    }
  });

  it('keeps the figure planted with no horizontal translation', () => {
    for (let t = 0; t < 30; t += 0.13) {
      expect(Object.keys(poseAt(t)).sort()).toEqual(['bob', 'breath', 'sway', 'tilt']);
    }
  });

  it('keeps every motion subtle', () => {
    for (let t = 0; t < 30; t += 0.13) {
      const pose = poseAt(t);
      expect(Math.abs(pose.bob)).toBeLessThanOrEqual(7);
      expect(Math.abs(pose.tilt)).toBeLessThanOrEqual(1.5*Math.PI/180);
      expect(Math.abs(pose.breath)).toBeLessThanOrEqual(0.007);
      expect(Math.abs(pose.sway)).toBeLessThanOrEqual(1.7*Math.PI/180);
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
    expect(start.gaze).toBeCloseTo(0, 10);
    expect(start.tilt).toBeCloseTo((1.2*Math.PI/180)*Math.sin(1.1), 10);
    expect(portraitPoseAt(1.3).bob).toBeCloseTo(portraitPoseAt(1.3+2.6).bob, 10);
    expect(portraitPoseAt(2.1).gaze).toBeCloseTo(portraitPoseAt(2.1+5.3).gaze, 10);
  });

  it('keeps the head planted: only bob, tilt, and the iris glance exist', () => {
    for (let t = 0; t < 30; t += 0.17) {
      expect(Object.keys(portraitPoseAt(t)).sort()).toEqual(['bob', 'gaze', 'tilt']);
    }
  });

  it('keeps the glance subtle and the head motion small', () => {
    for (let t = 0; t < 30; t += 0.17) {
      const pose = portraitPoseAt(t);
      expect(Math.abs(pose.bob)).toBeLessThanOrEqual(2.4);
      expect(Math.abs(pose.tilt)).toBeLessThanOrEqual(1.3*Math.PI/180);
      expect(Math.abs(pose.gaze)).toBeLessThanOrEqual(6);
    }
  });

  it('reports a friendly error when canvas 2d is unavailable', async () => {
    const errors: string[] = [];
    const stop = await playPortraitAnimation(document.createElement('canvas'), appearance, {onError: (message) => errors.push(message)});
    expect(errors).toEqual(['Unable to start the animated portrait on this device.']);
    expect(typeof stop).toBe('function');
    stop();
  });

  // Minimal 2d-context stand-in that composes transforms exactly like canvas
  // (each call post-multiplies the current transform) and records where the
  // head image lands. Lets the tests pin the portrait geometry without a
  // real canvas or artwork.
  function mockPortraitCtx() {
    // DOMMatrix-style {a,b,c,d,e,f}: point (x,y) -> (a*x+c*y+e, b*x+d*y+f).
    let m = {a: 1, b: 0, c: 0, d: 1, e: 0, f: 0};
    const stack: typeof m[] = [];
    const draws: {image: unknown; x: number; y: number; at: typeof m}[] = [];
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
      drawImage(image: unknown, x: number, y: number) { draws.push({image, x, y, at: {...m}}); },
      beginPath() {}, ellipse() {}, fill() {}, stroke() {},
      map(at: typeof m, x: number, y: number): [number, number] {
        return [at.a*x+at.c*y+at.e, at.b*x+at.d*y+at.f];
      },
      draws,
    };
    return ctx;
  }

  const still = {bob: 0, tilt: 0, gaze: 0};
  const headCanvas = {} as HTMLCanvasElement;
  const crop = {extent: 423, cx: 247, cy: 260};

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
    const pose = {bob: 2.4, tilt: 0, gaze: 0};
    drawPortraitFrame(ctx as unknown as CanvasRenderingContext2D, headCanvas, crop, [], [], '#e8b98f', pose, 1);
    const [x, y] = ctx.map(ctx.draws[0].at, crop.cx, crop.cy);
    const s = 320/crop.extent;
    expect(x).toBeCloseTo(160, 8);
    expect(y).toBeCloseTo(160+pose.bob*s, 8);
  });

  it('tilts around the head center, not around a corner', () => {
    const ctx = mockPortraitCtx();
    const pose = {bob: 0, tilt: 0.2, gaze: 0};
    drawPortraitFrame(ctx as unknown as CanvasRenderingContext2D, headCanvas, crop, [], [], '#e8b98f', pose, 1);
    const at = ctx.draws[0].at;
    const s = 320/crop.extent;
    // Two points symmetric about the head center stay symmetric about the
    // canvas center after the tilt: the rotation pivots on the head center.
    const [lx, ly] = ctx.map(at, crop.cx-50, crop.cy);
    const [rx, ry] = ctx.map(at, crop.cx+50, crop.cy);
    expect((lx+rx)/2).toBeCloseTo(160, 8);
    expect((ly+ry)/2).toBeCloseTo(160, 8);
    expect(Math.hypot(lx-160, ly-160)).toBeCloseTo(50*s, 8);
    expect(Math.hypot(rx-160, ry-160)).toBeCloseTo(50*s, 8);
  });
});
