import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

/** Total simulated thickness of the patch, in px — half sits on each face. */
const THICKNESS_PX = 10;
/** One 1px gold slice per px of thickness, forming the coin edge mid-spin. */
const EDGE_SLICES = THICKNESS_PX;
/** A press shorter than this is a click (opens details); beyond it is a spin drag. */
const DRAG_THRESHOLD_PX = 6;

type Props = {
  /** Face shown at rest — usually a PatchArtwork. */
  front: ReactNode;
  /** Face revealed by spinning — the shared achievement-patch back art. */
  back: ReactNode;
  className?: string;
};

/**
 * A 3D-spinnable achievement patch. Drag horizontally (or swipe on touch, or
 * use the arrow keys) to spin the patch around its vertical axis and reveal
 * the back face; a plain click or tap still reaches the parent control.
 * Stacked gold edge slices give the patch real thickness so it never reads
 * as a flat card mid-spin. Renders the front statically when the user prefers
 * reduced motion.
 */
export function SpinnablePatch({ front, back, className = "" }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const rotation = useRef(0);
  const gesture = useRef({ active: false, startX: 0, startRotation: 0, moved: false, width: 0 });
  const swallowClick = useRef(false);
  const [angle, setAngle] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (!window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(query.matches);
    const onChange = () => setReducedMotion(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  if (reducedMotion) return <div className={`ds-spin-patch ${className}`}>{front}</div>;

  const applyAngle = (deg: number) => {
    rotation.current = deg;
    setAngle(deg);
  };

  const begin = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const g = gesture.current;
    if (g.active) return;
    g.active = true;
    g.startX = event.clientX;
    g.startRotation = rotation.current;
    g.moved = false;
    g.width = root.current?.getBoundingClientRect().width ?? 0;
    setDragging(true);
    const move = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - g.startX;
      if (Math.abs(dx) > DRAG_THRESHOLD_PX) g.moved = true;
      if (g.width > 0) applyAngle(g.startRotation + (dx / g.width) * 180);
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      g.active = false;
      setDragging(false);
      if (g.moved) {
        // A real drag must not open the details dialog on release.
        swallowClick.current = true;
        applyAngle(Math.round(rotation.current / 180) * 180);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  const suppressClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (swallowClick.current) {
      swallowClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const nudge = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const snapped = Math.round(rotation.current / 180) * 180;
    applyAngle(snapped + (event.key === "ArrowRight" ? 180 : -180));
  };

  return (
    <div ref={root} className={`ds-spin-patch ${className}`} data-dragging={dragging || undefined}
      onPointerDown={begin} onClickCapture={suppressClick} onKeyDown={nudge}>
      <div className="ds-spin-patch__coin" style={{ transform: `rotateY(${angle}deg)` }}>
        <div className="ds-spin-patch__face ds-spin-patch__face--front">{front}</div>
        {Array.from({ length: EDGE_SLICES }, (_, i) => (
          <span key={i} aria-hidden="true" className="ds-spin-patch__edge"
            style={{ transform: `translate(-50%, -50%) translateZ(${(i - EDGE_SLICES / 2 + 0.5).toFixed(1)}px)` }} />
        ))}
        <div className="ds-spin-patch__face ds-spin-patch__face--back" aria-hidden="true">{back}</div>
      </div>
    </div>
  );
}
