import {describe, expect, it} from 'vitest';
import {blinkOpen, playCharacterAnimation, playPortraitAnimation, portraitPoseAt, poseAt} from './animate';
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
});
