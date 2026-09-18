import {useEffect, useMemo} from 'react';

/** Parallax amplitudes in CSS px. The blurred background drifts opposite the
 *  pointer while the character counter-moves minimally the other way, which
 *  sells the depth. Strong enough to read clearly on a phone — a casual
 *  ±15° tilt still moves the layers ~9px/4px, a full tilt goes dramatic —
 *  but still a preview garnish, not a ride. */
export const PARALLAX_BG_MAX = 28;
export const PARALLAX_CHAR_MAX = 12;
/** Real 3D card tilt: the character layer also rotates toward the input —
 *  rotateY follows left/right, rotateX the top-tilt-away convention — so the
 *  phone gyro reads as tilting a card, not sliding layers. ±8° at full
 *  deflection: a casual ±15° phone tilt reads clearly, a full tilt is
 *  dramatic but never nauseating. */
export const TILT_ROTATION_MAX = 8;
/** Perspective distance for the character layer's 3D tilt. Applied inline on
 *  the canvas itself (not the wrap) so the blurred backdrop keeps its flat
 *  2D translation. */
export const TILT_PERSPECTIVE_PX = 600;
/** Lerp factor per animation frame toward the target offset. */
export const PARALLAX_EASE = 0.12;

export type ParallaxOffset = {x: number; y: number};
export type RotationOffset = {rotateX: number; rotateY: number};
const NEUTRAL: ParallaxOffset = {x: 0, y: 0};

const clampUnit = (value: number) => Math.max(-1, Math.min(1, value));

/** Normalized pointer position (-1..1 on each axis) over the stage rect. Works
 *  for mouse and touch alike: touchmove reports the finger's position while
 *  it is down, which is exactly the Pokémon-card tilt input. */
export function pointerNormal(
  clientX: number, clientY: number,
  rect: {left: number; top: number; width: number; height: number},
): ParallaxOffset {
  if (rect.width <= 0 || rect.height <= 0) return {...NEUTRAL};
  return {
    x: clampUnit(((clientX-rect.left)/rect.width)*2-1),
    y: clampUnit(((clientY-rect.top)/rect.height)*2-1),
  };
}

/** Normalized tilt (-1..1 on each axis) from a deviceorientation reading.
 *  gamma is the left/right tilt; beta is front/back, where ~45deg is a phone
 *  held upright facing the viewer. Unknown readings stay neutral. */
export function orientationNormal(beta: number | null, gamma: number | null): ParallaxOffset {
  if (beta == null || gamma == null || Number.isNaN(beta) || Number.isNaN(gamma)) return {...NEUTRAL};
  return {x: clampUnit(gamma/45), y: clampUnit((beta-45)/45)};
}

/** Layer offsets in CSS px for a normalized input. The background moves
 *  opposite the input; the character counter-moves minimally the other way.
 *  The +0 normalizes -0 to 0 so settled offsets compare exactly. */
export function parallaxOffsets(input: ParallaxOffset): {bg: ParallaxOffset; char: ParallaxOffset} {
  return {
    bg: {x: -input.x*PARALLAX_BG_MAX+0, y: -input.y*PARALLAX_BG_MAX+0},
    char: {x: input.x*PARALLAX_CHAR_MAX+0, y: input.y*PARALLAX_CHAR_MAX+0},
  };
}

/** Card-tilt rotation in degrees for a normalized input. rotateY follows the
 *  left/right axis (input right tips the right edge away, Pokémon-card
 *  style); rotateX follows -y so the edge nearest the input tips away (input
 *  at the top tips the top edge away). The +0 normalizes -0 to 0 so settled
 *  rotations compare exactly. */
export function rotationOffsets(input: ParallaxOffset): RotationOffset {
  return {rotateX: -input.y*TILT_ROTATION_MAX+0, rotateY: input.x*TILT_ROTATION_MAX+0};
}

/** One easing step of the smoothed offset toward its target. Snaps to exactly
 *  zero once it settles at neutral so transforms can be cleared. */
export function stepParallax(current: ParallaxOffset, target: ParallaxOffset, ease = PARALLAX_EASE): ParallaxOffset {
  const x = current.x+(target.x-current.x)*ease;
  const y = current.y+(target.y-current.y)*ease;
  const settledX = Math.abs(x) < 0.02 && Math.abs(target.x) < 0.02;
  const settledY = Math.abs(y) < 0.02 && Math.abs(target.y) < 0.02;
  return {x: settledX ? 0 : x, y: settledY ? 0 : y};
}

export function isParallaxSettled(offset: ParallaxOffset): boolean {
  return offset.x === 0 && offset.y === 0;
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Outcome of the iOS motion permission request. 'denied' is an explicit iOS
 *  refusal (user tapped Don't Allow, or Motion & Orientation Access is off in
 *  Settings — iOS never re-prompts after that). 'error' is a throw, which must
 *  NOT be remembered as a denial: it fails silently for that open only and
 *  the next open tries again. */
export type MotionPermissionResult = 'granted' | 'denied' | 'error';

/**
 * iOS requires a user-gesture call to DeviceOrientationEvent.requestPermission
 * before deviceorientation events fire. Call this from the tap that opens the
 * fullscreen preview (the tap IS the gesture). Resolves 'granted' when motion
 * data may flow — granted, or no permission API at all (Android/desktop).
 */
export async function requestMotionPermission(): Promise<MotionPermissionResult> {
  try {
    const w = typeof window === 'undefined' ? undefined : (window as unknown as {
      DeviceOrientationEvent?: {requestPermission?: () => Promise<string>};
    });
    const request = w?.DeviceOrientationEvent?.requestPermission;
    if (typeof request === 'function') {
      return (await request.call(w?.DeviceOrientationEvent)) === 'granted' ? 'granted' : 'denied';
    }
    return 'granted';
  } catch {
    return 'error';
  }
}

/** True only where the iOS permission gate exists — the one place that needs
 *  the explicit "Enable tilt" opt-in button. Everywhere else the gyro starts
 *  on its own (Android) or never fires (desktop, no sensor). */
export function needsMotionPermission(): boolean {
  if (typeof window === 'undefined') return false;
  const doe = (window as unknown as {
    DeviceOrientationEvent?: {requestPermission?: unknown};
  }).DeviceOrientationEvent;
  return typeof doe?.requestPermission === 'function';
}

const TILT_OPT_IN_KEY = 'erudoza:tilt-opt-in';
const TILT_DENIED_KEY = 'erudoza:tilt-denied';
/** Fired on window when the tilt opt-in is granted, so UI (the "Enable tilt"
 *  button) can hide itself without polling. */
const TILT_GRANTED_EVENT = 'erudoza:tilt-granted';

function loadTiltOptIn(): boolean {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(TILT_OPT_IN_KEY) === '1'; }
  catch { return false; }
}

function saveTiltOptIn(): void {
  try { localStorage.setItem(TILT_OPT_IN_KEY, '1'); } catch { /* private mode: opt-in lasts this visit */ }
}

function loadTiltDenied(): boolean {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(TILT_DENIED_KEY) === '1'; }
  catch { return false; }
}

function saveTiltDenied(): void {
  try { localStorage.setItem(TILT_DENIED_KEY, '1'); } catch { /* private mode: denial lasts this visit */ }
}

function clearTiltDenied(): void {
  try { localStorage.removeItem(TILT_DENIED_KEY); } catch { /* noop */ }
}

function announceTiltGranted(): void {
  try { window.dispatchEvent(new CustomEvent(TILT_GRANTED_EVENT)); } catch { /* noop */ }
}

/** True once the iOS motion grant is in place (this visit or a remembered
 *  earlier one). UI uses this to hide the now-redundant "Enable tilt" button. */
export function isTiltOptedIn(): boolean {
  return tiltOptInGranted;
}

/** Live parallax controllers, so one "Enable tilt" tap arms the gyro on every
 *  mounted preview (inline and fullscreen share the per-origin grant). */
const tiltControllers = new Set<{startGyro: () => void}>();
let tiltOptInGranted = loadTiltOptIn();

/**
 * One-time tilt opt-in for iOS: call directly in the "Enable tilt" tap
 * handler, then the gyro subscribes and drives the tilt. Resolves true when
 * tilt is live. An explicit denial is remembered so later automatic attempts
 * stay silent (the button remains the manual retry); a later grant clears
 * the denial. A throw is NOT remembered — the next open tries again.
 * Either way the preview works; the parallax simply stays off until tilt is
 * live, with the pointer as the fallback.
 */
export async function enableTiltMotion(): Promise<boolean> {
  const result = await requestMotionPermission();
  if (result === 'granted') {
    tiltOptInGranted = true;
    saveTiltOptIn();
    clearTiltDenied();
    tiltControllers.forEach((controller) => controller.startGyro());
    announceTiltGranted();
    return true;
  }
  if (result === 'denied') saveTiltDenied();
  return false;
}

/**
 * Call from the tap that opens the fullscreen preview — the tap IS the user
 * gesture iOS requires for DeviceOrientationEvent.requestPermission(). Where
 * no permission gate exists (Android/desktop) this is a no-op that resolves
 * true: the gyro is already live. After a denial it resolves false without
 * re-prompting, so opening the preview never nags; the fullscreen "Enable
 * tilt" button stays available as the manual retry.
 */
export async function requestTiltOnOpen(): Promise<boolean> {
  if (!needsMotionPermission()) return true;
  if (tiltOptInGranted || loadTiltDenied()) return tiltOptInGranted;
  return enableTiltMotion();
}

/** Test-only reset for the module-level tilt opt-in state. */
export function _resetTiltMotion(): void {
  tiltOptInGranted = false;
  try {
    localStorage.removeItem(TILT_OPT_IN_KEY);
    localStorage.removeItem(TILT_DENIED_KEY);
  } catch { /* noop */ }
}

type ParallaxController = {
  setWrap: (el: HTMLDivElement | null) => void;
  setFill: (el: HTMLImageElement | null) => void;
  setCanvas: (el: HTMLCanvasElement | null) => void;
  dispose: () => void;
};

function createParallaxController(): ParallaxController {
  let wrap: HTMLDivElement | null = null;
  let fill: HTMLImageElement | null = null;
  let canvas: HTMLCanvasElement | null = null;
  // Two inputs share one smoothing pipeline: the pointer (mouse / finger)
  // always drives, and the gyro takes precedence once it is live — i.e. the
  // user opted in on iOS, or readings started flowing on Android.
  let pointerTarget: ParallaxOffset = {...NEUTRAL};
  let gyroTarget: ParallaxOffset = {...NEUTRAL};
  let gyroLive = false;
  let gyroSubscribed = false;
  let current: ParallaxOffset = {...NEUTRAL};
  let raf = 0;

  const effectiveTarget = () => (gyroLive ? gyroTarget : pointerTarget);
  const apply = () => {
    const {bg, char} = parallaxOffsets(current);
    // The fill keeps its decorative 1.12 scale; parallax is layered on top.
    if (fill) fill.style.transform = isParallaxSettled(current) ? '' : `translate3d(${bg.x.toFixed(2)}px, ${bg.y.toFixed(2)}px, 0) scale(1.12)`;
    if (canvas) {
      if (isParallaxSettled(current)) {
        canvas.style.transform = '';
        return;
      }
      // The character layer gets the 3D card tilt on top of its 2D drift:
      // rotate first around the layer center, then drift in screen axes,
      // then project through the inline perspective. The fill above stays
      // flat 2D — only the character tilts.
      const {rotateX, rotateY} = rotationOffsets(current);
      canvas.style.transform = `perspective(${TILT_PERSPECTIVE_PX}px) translate3d(${char.x.toFixed(2)}px, ${char.y.toFixed(2)}px, 0) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg)`;
    }
  };
  const tick = () => {
    raf = 0;
    const target = effectiveTarget();
    current = stepParallax(current, target);
    apply();
    if (!isParallaxSettled(current) || !isParallaxSettled(target)) raf = requestAnimationFrame(tick);
  };
  const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };
  const setPointerTarget = (next: ParallaxOffset) => { pointerTarget = next; kick(); };

  const onTilt = (event: DeviceOrientationEvent) => {
    if (event.beta == null || event.gamma == null) return;
    gyroTarget = orientationNormal(event.beta, event.gamma);
    gyroLive = true;
    kick();
  };
  const startGyro = () => {
    if (gyroSubscribed || typeof window === 'undefined') return;
    gyroSubscribed = true;
    window.addEventListener('deviceorientation', onTilt);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!wrap) return;
    setPointerTarget(pointerNormal(event.clientX, event.clientY, wrap.getBoundingClientRect()));
  };
  // pointerleave (mouse out / finger up) and pointercancel (the browser took
  // over the touch for scrolling) both drop the pointer input to neutral.
  const onPointerEnd = () => setPointerTarget({...NEUTRAL});

  const registration = {startGyro};
  tiltControllers.add(registration);
  // No permission gate (Android/desktop): the gyro starts on its own. On iOS
  // it waits for the "Enable tilt" tap — or a remembered earlier grant.
  if (!needsMotionPermission() || tiltOptInGranted) startGyro();

  return {
    setWrap: (el) => {
      if (wrap) {
        wrap.removeEventListener('pointermove', onPointerMove);
        wrap.removeEventListener('pointerleave', onPointerEnd);
        wrap.removeEventListener('pointercancel', onPointerEnd);
      }
      wrap = el;
      if (wrap) {
        // One listener covers mouse, touch, and pen: pointermove fires for the
        // mouse as it crosses the stage and for the finger's position while
        // it is down. The stage uses touch-action: pan-y inline (vertical
        // scroll is never hijacked) and touch-action: none in fullscreen.
        wrap.addEventListener('pointermove', onPointerMove);
        wrap.addEventListener('pointerleave', onPointerEnd);
        wrap.addEventListener('pointercancel', onPointerEnd);
      }
    },
    setFill: (el) => { fill = el; },
    setCanvas: (el) => { canvas = el; },
    dispose: () => {
      tiltControllers.delete(registration);
      if (gyroSubscribed && typeof window !== 'undefined') {
        window.removeEventListener('deviceorientation', onTilt);
      }
      gyroSubscribed = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (wrap) {
        wrap.removeEventListener('pointermove', onPointerMove);
        wrap.removeEventListener('pointerleave', onPointerEnd);
        wrap.removeEventListener('pointercancel', onPointerEnd);
        wrap = null;
      }
    },
  };
}

export type StageParallax = {
  /** Ref for the stage wrapper; drives pointer parallax (mouse + touch). */
  wrapRef: (el: HTMLDivElement | null) => void;
  /** Ref for the blurred backdrop img (background layer). */
  fillRef: (el: HTMLImageElement | null) => void;
  /** Ref for the character canvas (foreground layer). */
  canvasRef: (el: HTMLCanvasElement | null) => void;
  /** False under prefers-reduced-motion: no listeners, no motion, ever. */
  enabled: boolean;
};

/**
 * Eased two-layer parallax for the character stage, plus a real 3D card tilt
 * on the character layer. Two inputs share one smoothing pipeline: the
 * pointer — mouse crossing the stage on desktop, finger position while
 * touching on mobile — and, where available, the phone gyro (iOS asks once
 * via an "Enable tilt" tap; Android starts on its own). The gyro takes
 * precedence once live; the pointer is always the fallback. The character
 * layer rotates up to ±8° (rotateX/rotateY through a 600px perspective) while
 * the layers drift in 2D behind it, so tilting the phone feels like tilting
 * a card. Input eases back to neutral when it ends, so the idle planted
 * guarantee is untouched — this is input-driven garnish only, never idle
 * drift. Fully off under prefers-reduced-motion.
 */
export function useStageParallax(): StageParallax {
  const controller = useMemo(() => (prefersReducedMotion() ? null : createParallaxController()), []);
  useEffect(() => () => controller?.dispose(), [controller]);
  return useMemo<StageParallax>(() => {
    if (!controller) {
      const noop = () => {};
      return {wrapRef: noop, fillRef: noop, canvasRef: noop, enabled: false};
    }
    return {
      enabled: true,
      wrapRef: (el) => controller.setWrap(el),
      fillRef: (el) => controller.setFill(el),
      canvasRef: (el) => controller.setCanvas(el),
    };
  }, [controller]);
}
