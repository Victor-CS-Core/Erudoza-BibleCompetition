import {describe, expect, it} from 'vitest';
import {blinkOpen, playCharacterAnimation, poseAt} from './animate';
import type {Configuration} from './composition';

const config: Configuration = {
  bodyType: 'male', style: 'curls', hairColor: 'brown', attire: 'student',
  skin: 'medium', eyes: 'brown', background: 'sunrise', slots: [null, null, null],
};

describe('character idle animation', () => {
  it('starts the head at rest and loops each motion on its own period', () => {
    const start = poseAt(0);
    expect(start.bob).toBe(0);
    expect(start.drift).toBe(0);
    expect(start.tilt).toBeCloseTo((1.4*Math.PI/180)*Math.sin(1.1), 10);
    for (const t of [0.7, 2.1, 5.3]) {
      expect(poseAt(t).bob).toBeCloseTo(poseAt(t+2.6).bob, 10);
      expect(poseAt(t).drift).toBeCloseTo(poseAt(t+7.5).drift, 10);
    }
  });

  it('keeps every motion subtle', () => {
    for (let t = 0; t < 30; t += 0.13) {
      const pose = poseAt(t);
      expect(Math.abs(pose.bob)).toBeLessThanOrEqual(7);
      expect(Math.abs(pose.tilt)).toBeLessThanOrEqual(1.5*Math.PI/180);
      expect(Math.abs(pose.breath)).toBeLessThanOrEqual(0.007);
      expect(Math.abs(pose.sway)).toBeLessThanOrEqual(1.7*Math.PI/180);
      expect(Math.abs(pose.drift)).toBeLessThanOrEqual(12);
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
