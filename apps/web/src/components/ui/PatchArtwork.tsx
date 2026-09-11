import { type ComponentPropsWithoutRef, type CSSProperties, useEffect, useRef } from "react";

type Props = Omit<ComponentPropsWithoutRef<"img">, "width" | "height"> & {
  size?: number;
  width?: number;
  height?: number;
  muted?: boolean;
};

/** The stationary surface owns pointer bounds; only its decorative bitmap moves. */
export function PatchArtwork({ size = 96, width = size, height = size, className = "", muted = false, sizes = `${width}px`, alt = "", loading = "lazy", ...imageProps }: Props) {
  const surface = useRef<HTMLSpanElement>(null);
  const artwork = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const host = surface.current!;
    const img = artwork.current!;
    if (!window.matchMedia) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    let frame = 0, last = 0, x = 0, y = 0, lift = 0, targetX = 0, targetY = 0, targetLift = 0, travel = 4;
    const allowed = () => !reduce.matches && fine.matches && !document.hidden;
    const resetStyles = () => {
      for (const property of ["transform", "will-change", "--patch-shadow-x", "--patch-shadow-y", "--patch-shadow-blur"]) img.style.removeProperty(property);
    };
    const stop = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = last = x = y = lift = targetX = targetY = targetLift = 0;
      resetStyles();
    };
    const tick = (time: number) => {
      if (!allowed()) { stop(); return; }
      const blend = 1 - Math.exp(-Math.min(last ? time - last : 16, 64) / 90);
      last = time;
      x += (targetX - x) * blend; y += (targetY - y) * blend; lift += (targetLift - lift) * blend;
      img.style.transform = `translate3d(0, ${(-travel * lift).toFixed(3)}px, 0) rotateX(${x.toFixed(3)}deg) rotateY(${y.toFixed(3)}deg) scale(${(1 + .025 * lift).toFixed(4)})`;
      img.style.setProperty("--patch-shadow-x", `${(-y * travel / 7).toFixed(3)}px`);
      img.style.setProperty("--patch-shadow-y", `${(2 + travel * 1.6 * lift - x * travel / 14).toFixed(3)}px`);
      img.style.setProperty("--patch-shadow-blur", `${(3 + travel * 1.2 * lift).toFixed(3)}px`);
      if (Math.abs(targetX - x) + Math.abs(targetY - y) + Math.abs(targetLift - lift) < .005) {
        frame = last = 0;
        img.style.removeProperty("will-change");
        if (!targetLift) resetStyles();
      } else frame = requestAnimationFrame(tick);
    };
    const animate = () => { if (!frame) { img.style.willChange = "transform, filter"; frame = requestAnimationFrame(tick); } };
    const move = (event: PointerEvent) => {
      if (!allowed() || event.pointerType === "touch") return;
      const rect = host.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const clamp = (n: number) => Math.max(-1, Math.min(1, n));
      // The edge under the pointer dips away while the whole patch lifts gently.
      targetX = -clamp((event.clientY - rect.top) / rect.height * 2 - 1) * 7;
      targetY = clamp((event.clientX - rect.left) / rect.width * 2 - 1) * 7;
      travel = Math.max(2, Math.min(6, Math.min(rect.width, rect.height) * .04));
      targetLift = 1;
      animate();
    };
    const leave = () => { targetX = targetY = targetLift = 0; if (allowed()) animate(); else stop(); };
    const preferenceChanged = () => { if (!allowed()) stop(); };
    host.addEventListener("pointerenter", move);
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerleave", leave);
    host.addEventListener("pointercancel", leave);
    reduce.addEventListener("change", preferenceChanged);
    fine.addEventListener("change", preferenceChanged);
    document.addEventListener("visibilitychange", preferenceChanged);
    window.addEventListener("blur", stop);
    return () => {
      stop();
      host.removeEventListener("pointerenter", move); host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerleave", leave); host.removeEventListener("pointercancel", leave);
      reduce.removeEventListener("change", preferenceChanged); fine.removeEventListener("change", preferenceChanged);
      document.removeEventListener("visibilitychange", preferenceChanged); window.removeEventListener("blur", stop);
    };
  }, []);
  return <span ref={surface} className={`ds-patch-art ${className}${muted ? " ds-patch-art-unearned" : ""}`} style={{ "--patch-width": `${width}px`, "--patch-height": `${height}px` } as CSSProperties}><img {...imageProps} ref={artwork} sizes={sizes} alt={alt} width={width} height={height} loading={loading} decoding="async" draggable={false} /></span>;
}
