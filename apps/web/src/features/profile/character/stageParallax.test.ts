import {afterEach, describe, expect, it, vi} from 'vitest';
import {renderHook} from '@testing-library/react';
import {
  PARALLAX_BG_MAX, PARALLAX_CHAR_MAX, TILT_ROTATION_MAX,
  _resetTiltMotion, enableTiltMotion, isParallaxSettled, isTiltOptedIn, needsMotionPermission,
  orientationNormal, parallaxOffsets, pointerNormal, prefersReducedMotion,
  requestMotionPermission, requestTiltOnOpen, rotationOffsets, stepParallax, useStageParallax,
} from './stageParallax';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (window as unknown as {DeviceOrientationEvent?: unknown}).DeviceOrientationEvent;
  _resetTiltMotion();
});

function stubIOSGate(result: 'granted' | 'denied') {
  const requestPermission = vi.fn().mockResolvedValue(result);
  const doe = {requestPermission};
  vi.stubGlobal('DeviceOrientationEvent', doe);
  (window as unknown as {DeviceOrientationEvent: unknown}).DeviceOrientationEvent = doe;
  return requestPermission;
}

function stubNoReducedMotion() {
  vi.stubGlobal('matchMedia', () => ({
    matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
}

function captureRaf() {
  let frame: FrameRequestCallback | null = null;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frame = cb; return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  return () => {
    expect(frame).not.toBeNull();
    return frame!;
  };
}

function mockStage() {
  const wrap = document.createElement('div');
  vi.spyOn(wrap, 'getBoundingClientRect').mockReturnValue(
    {left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({})},
  );
  return {wrap, fill: document.createElement('img'), canvas: document.createElement('canvas')};
}

function dispatchTilt(beta: number, gamma: number) {
  const event = new Event('deviceorientation');
  Object.assign(event, {beta, gamma});
  window.dispatchEvent(event);
}

describe('stage parallax math', () => {
  it('normalizes the pointer to -1..1 over the stage rect', () => {
    const rect = {left: 10, top: 20, width: 200, height: 100};
    expect(pointerNormal(110, 70, rect)).toEqual({x: 0, y: 0});
    expect(pointerNormal(10, 20, rect)).toEqual({x: -1, y: -1});
    expect(pointerNormal(210, 120, rect)).toEqual({x: 1, y: 1});
    // Outside the rect clamps instead of overshooting.
    expect(pointerNormal(1000, -500, rect)).toEqual({x: 1, y: -1});
  });

  it('stays neutral for a degenerate rect', () => {
    expect(pointerNormal(5, 5, {left: 0, top: 0, width: 0, height: 0})).toEqual({x: 0, y: 0});
  });

  it('maps device tilt to -1..1, upright phone as neutral', () => {
    expect(orientationNormal(45, 0)).toEqual({x: 0, y: 0});
    expect(orientationNormal(45, 45)).toEqual({x: 1, y: 0});
    expect(orientationNormal(45, -45)).toEqual({x: -1, y: 0});
    expect(orientationNormal(90, 0).y).toBe(1);
    expect(orientationNormal(0, 0).y).toBe(-1);
    // Extreme tilts clamp.
    expect(orientationNormal(45, 120)).toEqual({x: 1, y: 0});
    // Unknown readings stay neutral.
    expect(orientationNormal(null, 10)).toEqual({x: 0, y: 0});
    expect(orientationNormal(45, Number.NaN)).toEqual({x: 0, y: 0});
  });

  it('moves the background opposite the input and the character minimally the other way', () => {
    const {bg, char} = parallaxOffsets({x: 1, y: -0.5});
    expect(bg).toEqual({x: -PARALLAX_BG_MAX, y: PARALLAX_BG_MAX/2});
    expect(char).toEqual({x: PARALLAX_CHAR_MAX, y: -PARALLAX_CHAR_MAX/2});
    // Directions oppose each other on both axes.
    expect(Math.sign(bg.x)).toBe(-Math.sign(char.x));
    expect(Math.sign(bg.y)).toBe(-Math.sign(char.y));
    // Amplitudes stay readable on a phone: background ±28px, character ±12px.
    expect(Math.abs(bg.x)).toBeLessThanOrEqual(PARALLAX_BG_MAX);
    expect(Math.abs(char.x)).toBeLessThanOrEqual(PARALLAX_CHAR_MAX);
    expect(parallaxOffsets({x: 0, y: 0})).toEqual({bg: {x: 0, y: 0}, char: {x: 0, y: 0}});
  });

  it('eases toward the target and snaps back to neutral', () => {    const target = {x: -10, y: 5};
    let current = {x: 0, y: 0};
    let previous = Math.hypot(target.x, target.y);
    for (let i = 0; i < 200; i++) {
      current = stepParallax(current, target);
      const dist = Math.hypot(target.x-current.x, target.y-current.y);
      expect(dist).toBeLessThanOrEqual(previous+1e-9);
      previous = dist;
    }
    expect(Math.abs(current.x-target.x)).toBeLessThan(0.05);
    // Easing back to neutral settles at exactly zero so transforms clear.
    for (let i = 0; i < 200; i++) current = stepParallax(current, {x: 0, y: 0});
    expect(current).toEqual({x: 0, y: 0});
    expect(isParallaxSettled(current)).toBe(true);
    expect(isParallaxSettled({x: 0.5, y: 0})).toBe(false);
  });
});

describe('card tilt rotation', () => {
  it('maps normalized input to degrees with the card-tilt sign convention', () => {
    // rotateY follows x: input right tips the right edge away (Pokémon-card style).
    expect(rotationOffsets({x: 1, y: 0})).toEqual({rotateX: 0, rotateY: TILT_ROTATION_MAX});
    expect(rotationOffsets({x: -1, y: 0})).toEqual({rotateX: 0, rotateY: -TILT_ROTATION_MAX});
    // rotateX follows -y: input at the top tips the top edge away.
    expect(rotationOffsets({x: 0, y: -1})).toEqual({rotateX: TILT_ROTATION_MAX, rotateY: 0});
    expect(rotationOffsets({x: 0, y: 1})).toEqual({rotateX: -TILT_ROTATION_MAX, rotateY: 0});
    // Amplitudes scale linearly and stay bounded by the max.
    expect(rotationOffsets({x: 0.5, y: -0.25})).toEqual({rotateX: 2, rotateY: 4});
    expect(Math.abs(rotationOffsets({x: 1, y: 1}).rotateX)).toBeLessThanOrEqual(TILT_ROTATION_MAX);
    expect(Math.abs(rotationOffsets({x: 1, y: 1}).rotateY)).toBeLessThanOrEqual(TILT_ROTATION_MAX);
    // Neutral stays neutral, and -0 normalizes to 0 so settled rotations
    // compare exactly.
    expect(rotationOffsets({x: 0, y: 0})).toEqual({rotateX: 0, rotateY: 0});
    expect(rotationOffsets({x: -0, y: -0})).toEqual({rotateX: 0, rotateY: 0});
  });

  it('settles through the same easing pipeline so transforms clear', () => {
    let current = {x: 0.5, y: -0.5};
    for (let i = 0; i < 200; i++) current = stepParallax(current, {x: 0, y: 0});
    expect(current).toEqual({x: 0, y: 0});
    expect(rotationOffsets(current)).toEqual({rotateX: 0, rotateY: 0});
    expect(isParallaxSettled(current)).toBe(true);
    expect(isParallaxSettled({x: 0.5, y: 0})).toBe(false);
  });
});

describe('motion permission', () => {
  it('needs the opt-in only where the iOS permission gate exists', () => {
    expect(needsMotionPermission()).toBe(false);
    stubIOSGate('granted');
    expect(needsMotionPermission()).toBe(true);
  });

  it('allows motion where no permission API exists (Android/desktop)', async () => {
    await expect(requestMotionPermission()).resolves.toBe('granted');
  });

  it('resolves granted only when iOS grants permission', async () => {
    const requestPermission = stubIOSGate('granted');
    await expect(requestMotionPermission()).resolves.toBe('granted');
    expect(requestPermission).toHaveBeenCalled();
  });

  it('distinguishes an explicit denial from a throw', async () => {
    stubIOSGate('denied');
    await expect(requestMotionPermission()).resolves.toBe('denied');
    const throwing = {requestPermission: vi.fn().mockRejectedValue(new Error('nope'))};
    vi.stubGlobal('DeviceOrientationEvent', throwing);
    (window as unknown as {DeviceOrientationEvent: unknown}).DeviceOrientationEvent = throwing;
    await expect(requestMotionPermission()).resolves.toBe('error');
  });
});

describe('tilt motion (gyroscope)', () => {
  it('does not subscribe on iOS until the opt-in tap grants permission', async () => {
    stubNoReducedMotion();
    stubIOSGate('granted');
    const addSpy = vi.spyOn(window, 'addEventListener');
    const nextFrame = captureRaf();
    const {result, unmount} = renderHook(() => useStageParallax());
    const {wrap, fill, canvas} = mockStage();
    result.current.wrapRef(wrap);
    result.current.fillRef(fill);
    result.current.canvasRef(canvas);

    expect(addSpy.mock.calls.filter((c) => c[0] === 'deviceorientation')).toHaveLength(0);
    // Tilt readings before the grant go nowhere.
    dispatchTilt(45, 45);
    // The opt-in tap: permission granted, gyro subscribes.
    await expect(enableTiltMotion()).resolves.toBe(true);
    expect(addSpy.mock.calls.filter((c) => c[0] === 'deviceorientation')).toHaveLength(1);

    // Gyro now drives the same offsets as the pointer path: gamma 45 (full
    // right tilt) pushes the background left and the character right, and
    // rotates the character layer like a card. The fill stays flat 2D.
    dispatchTilt(45, 45);
    nextFrame()(0);
    expect(fill.style.transform).toBe('translate3d(-3.36px, 0.00px, 0) scale(1.12)');
    expect(fill.style.transform).not.toContain('rotate');
    expect(canvas.style.transform).toBe('perspective(600px) translate3d(1.44px, 0.00px, 0) rotateX(0.00deg) rotateY(0.96deg)');

    // Gyro takes precedence over the pointer once live: a pointer hard left
    // would ease toward +28, but the tilt keeps easing toward -28 — and the
    // card rotation keeps following the gyro too.
    wrap.dispatchEvent(new MouseEvent('pointermove', {clientX: 0, clientY: 50}));
    nextFrame()(1);
    expect(fill.style.transform).toBe('translate3d(-6.32px, 0.00px, 0) scale(1.12)');
    expect(canvas.style.transform).toBe('perspective(600px) translate3d(2.71px, 0.00px, 0) rotateX(0.00deg) rotateY(1.80deg)');
    unmount();
  });

  it('falls back to the pointer when iOS permission is denied', async () => {
    stubNoReducedMotion();
    stubIOSGate('denied');
    const addSpy = vi.spyOn(window, 'addEventListener');
    const nextFrame = captureRaf();
    const {result, unmount} = renderHook(() => useStageParallax());
    const {wrap, fill} = mockStage();
    result.current.wrapRef(wrap);
    result.current.fillRef(fill);

    await expect(enableTiltMotion()).resolves.toBe(false);
    expect(addSpy.mock.calls.filter((c) => c[0] === 'deviceorientation')).toHaveLength(0);
    // Denied tilt never hijacks: the pointer still drives.
    wrap.dispatchEvent(new MouseEvent('pointermove', {clientX: 200, clientY: 50}));
    nextFrame()(0);
    expect(fill.style.transform).toBe('translate3d(-3.36px, 0.00px, 0) scale(1.12)');
    unmount();
  });

  it('starts the gyro automatically where no permission gate exists (Android)', () => {
    stubNoReducedMotion();
    const addSpy = vi.spyOn(window, 'addEventListener');
    const nextFrame = captureRaf();
    const {result, unmount} = renderHook(() => useStageParallax());
    const {fill} = mockStage();
    result.current.fillRef(fill);

    expect(addSpy.mock.calls.filter((c) => c[0] === 'deviceorientation')).toHaveLength(1);
    // beta 90 (leaned fully back) pushes the background down.
    dispatchTilt(90, 0);
    nextFrame()(0);
    expect(fill.style.transform).toBe('translate3d(0.00px, -3.36px, 0) scale(1.12)');
    unmount();
  });

  it('remembers the iOS grant so later visits start the gyro without asking', async () => {
    stubNoReducedMotion();
    stubIOSGate('granted');
    const first = renderHook(() => useStageParallax());
    await expect(enableTiltMotion()).resolves.toBe(true);
    first.unmount();

    // Fresh controller, e.g. next visit: the remembered grant auto-starts.
    const addSpy = vi.spyOn(window, 'addEventListener');
    const {unmount} = renderHook(() => useStageParallax());
    expect(addSpy.mock.calls.filter((c) => c[0] === 'deviceorientation')).toHaveLength(1);
    unmount();
  });
});

describe('requestTiltOnOpen', () => {
  it('is a silent no-op where no permission gate exists (Android/desktop)', async () => {
    stubNoReducedMotion();
    const addSpy = vi.spyOn(window, 'addEventListener');
    await expect(requestTiltOnOpen()).resolves.toBe(true);
    // No gate, no prompt: the gyro was already subscribed at hook creation.
    expect(addSpy.mock.calls.filter((c) => c[0] === 'deviceorientation')).toHaveLength(0);
  });

  it('asks once from the open tap on iOS and remembers the grant', async () => {
    stubNoReducedMotion();
    stubIOSGate('granted');
    const requestPermission = (window as unknown as {DeviceOrientationEvent: {requestPermission: ReturnType<typeof vi.fn>}}).DeviceOrientationEvent.requestPermission;

    await expect(requestTiltOnOpen()).resolves.toBe(true);
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(isTiltOptedIn()).toBe(true);

    // Already opted in: later opens never re-prompt.
    await expect(requestTiltOnOpen()).resolves.toBe(true);
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it('stays silent after a denial but the manual button can still retry', async () => {
    stubNoReducedMotion();
    const requestPermission = stubIOSGate('denied');

    await expect(requestTiltOnOpen()).resolves.toBe(false);
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(isTiltOptedIn()).toBe(false);

    // The denial is remembered: opening the preview never nags.
    await expect(requestTiltOnOpen()).resolves.toBe(false);
    expect(requestPermission).toHaveBeenCalledTimes(1);

    // The manual "Enable tilt" button bypasses the denial memory. If the
    // user grants there, the denial clears and tilt goes live.
    requestPermission.mockResolvedValue('granted');
    const granted = new Promise<boolean>((resolve) => {
      window.addEventListener('erudoza:tilt-granted', () => resolve(true), {once: true});
    });
    await expect(enableTiltMotion()).resolves.toBe(true);
    await expect(granted).resolves.toBe(true);
    expect(isTiltOptedIn()).toBe(true);
    expect(requestPermission).toHaveBeenCalledTimes(2);

    // Denial cleared: the open tap no longer suppresses itself.
    await expect(requestTiltOnOpen()).resolves.toBe(true);
    expect(requestPermission).toHaveBeenCalledTimes(2);
  });

  it('forgets the denial on reset', async () => {
    stubNoReducedMotion();
    const requestPermission = stubIOSGate('denied');
    await expect(requestTiltOnOpen()).resolves.toBe(false);
    _resetTiltMotion();
    await expect(requestTiltOnOpen()).resolves.toBe(false);
    expect(requestPermission).toHaveBeenCalledTimes(2);
  });

  it('does not remember a thrown permission request as a denial', async () => {
    stubNoReducedMotion();
    const throwing = {requestPermission: vi.fn().mockRejectedValue(new Error('nope'))};
    vi.stubGlobal('DeviceOrientationEvent', throwing);
    (window as unknown as {DeviceOrientationEvent: unknown}).DeviceOrientationEvent = throwing;

    // The throw fails silently for this open only.
    await expect(enableTiltMotion()).resolves.toBe(false);
    expect(isTiltOptedIn()).toBe(false);

    // No denial was recorded, so the next open re-attempts the request
    // instead of suppressing itself — and a grant then goes live.
    await expect(requestTiltOnOpen()).resolves.toBe(false);
    expect(throwing.requestPermission).toHaveBeenCalledTimes(2);
    throwing.requestPermission.mockResolvedValue('granted');
    await expect(requestTiltOnOpen()).resolves.toBe(true);
    expect(isTiltOptedIn()).toBe(true);
  });
});

describe('useStageParallax', () => {
  it('stays fully off under prefers-reduced-motion', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduced-motion'),
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }));
    expect(prefersReducedMotion()).toBe(true);
    const frame = vi.fn();
    vi.stubGlobal('requestAnimationFrame', frame);
    const {result, unmount} = renderHook(() => useStageParallax());
    expect(result.current.enabled).toBe(false);
    const wrap = document.createElement('div');
    const spy = vi.spyOn(wrap, 'addEventListener');
    result.current.wrapRef(wrap);
    expect(spy).not.toHaveBeenCalled();
    expect(frame).not.toHaveBeenCalled();
    unmount();
  });

  it('is enabled otherwise and wires the wrap without crashing', () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }));
    const {result, unmount} = renderHook(() => useStageParallax());
    expect(result.current.enabled).toBe(true);
    const wrap = document.createElement('div');
    result.current.wrapRef(wrap);
    result.current.wrapRef(null);
    unmount();
  });

  it('drives the layers from pointer position and eases back to neutral on leave', () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }));
    let frame: FrameRequestCallback | null = null;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frame = cb; return 1; });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const {result, unmount} = renderHook(() => useStageParallax());
    const wrap = document.createElement('div');
    vi.spyOn(wrap, 'getBoundingClientRect').mockReturnValue(
      {left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({})},
    );
    const fill = document.createElement('img');
    const canvas = document.createElement('canvas');
    result.current.wrapRef(wrap);
    result.current.fillRef(fill);
    result.current.canvasRef(canvas);

    // Pointer (mouse or finger) at the right edge: background drifts left,
    // character counter-moves right and rotates like a card, eased 0.12
    // toward the target. The fill keeps its flat 2D translate+scale.
    wrap.dispatchEvent(new MouseEvent('pointermove', {clientX: 200, clientY: 50}));
    expect(frame).not.toBeNull();
    frame!(0);
    expect(fill.style.transform).toBe('translate3d(-3.36px, 0.00px, 0) scale(1.12)');
    expect(fill.style.transform).not.toContain('rotate');
    expect(canvas.style.transform).toBe('perspective(600px) translate3d(1.44px, 0.00px, 0) rotateX(0.00deg) rotateY(0.96deg)');

    // Finger at the bottom edge: rotateX tips the bottom edge away (full
    // deflection is -8°, here eased 0.12 toward it).
    wrap.dispatchEvent(new MouseEvent('pointermove', {clientX: 100, clientY: 100}));
    frame!(1);
    expect(canvas.style.transform).toBe('perspective(600px) translate3d(1.27px, 1.44px, 0) rotateX(-0.96deg) rotateY(0.84deg)');

    // Pointer leaves: eases back to neutral and the transforms clear.
    wrap.dispatchEvent(new MouseEvent('pointerleave'));
    for (let i = 0; i < 200 && fill.style.transform !== ''; i++) frame!(i);
    expect(fill.style.transform).toBe('');
    expect(canvas.style.transform).toBe('');
    unmount();
  });

  it('resets to neutral on pointercancel (scroll takeover)', () => {
    stubNoReducedMotion();
    const nextFrame = captureRaf();
    const {result, unmount} = renderHook(() => useStageParallax());
    const {wrap, fill, canvas} = mockStage();
    result.current.wrapRef(wrap);
    result.current.fillRef(fill);
    result.current.canvasRef(canvas);

    wrap.dispatchEvent(new MouseEvent('pointermove', {clientX: 200, clientY: 50}));
    nextFrame()(0);
    expect(fill.style.transform).not.toBe('');

    // The browser took the touch for scrolling: pointer input drops out and
    // the tilt eases back to neutral instead of sticking.
    wrap.dispatchEvent(new MouseEvent('pointercancel'));
    for (let i = 0; i < 200 && fill.style.transform !== ''; i++) nextFrame()(i);
    expect(fill.style.transform).toBe('');
    expect(canvas.style.transform).toBe('');
    unmount();
  });
});
