import { useEffect, useRef } from "react";

/** Decorative pointer motion never moves the focus target or surrounding copy. */
export function HonorArtwork({ src, srcSet, alt = "", size = 96, muted = false }: {
  src: string; srcSet?: string; alt?: string; size?: number; muted?: boolean;
}) {
  const surface = useRef<HTMLSpanElement>(null);
  const artwork = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const host = surface.current!;
    const img = artwork.current!;
    if (!window.matchMedia) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    let frame = 0, last = 0, x = 0, y = 0, targetX = 0, targetY = 0;
    const allowed = () => !reduce.matches && fine.matches && !document.hidden;
    const stop = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = last = x = y = targetX = targetY = 0;
      img.style.removeProperty("transform");
      img.style.removeProperty("will-change");
    };
    const tick = (time: number) => {
      if (!allowed()) { stop(); return; }
      const blend = 1 - Math.exp(-Math.min(last ? time - last : 16, 64) / 70);
      last = time; x += (targetX - x) * blend; y += (targetY - y) * blend;
      img.style.transform = `rotateX(${x.toFixed(3)}deg) rotateY(${y.toFixed(3)}deg)`;
      if (Math.abs(targetX - x) + Math.abs(targetY - y) < .02) {
        frame = last = 0;
        img.style.removeProperty("will-change");
        if (!targetX && !targetY) img.style.removeProperty("transform");
      } else frame = requestAnimationFrame(tick);
    };
    const animate = () => { if (!frame) { img.style.willChange = "transform"; frame = requestAnimationFrame(tick); } };
    const move = (event: PointerEvent) => {
      if (!allowed() || event.pointerType === "touch") return;
      const rect = host.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const clamp = (n: number) => Math.max(-1, Math.min(1, n));
      targetX = -clamp((event.clientY - rect.top) / rect.height * 2 - 1) * 7;
      targetY = clamp((event.clientX - rect.left) / rect.width * 2 - 1) * 7;
      animate();
    };
    const leave = () => { targetX = targetY = 0; if (allowed()) animate(); else stop(); };
    const preferenceChanged = () => { if (!allowed()) stop(); };
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerleave", leave);
    host.addEventListener("pointercancel", leave);
    reduce.addEventListener("change", preferenceChanged);
    fine.addEventListener("change", preferenceChanged);
    document.addEventListener("visibilitychange", preferenceChanged);
    return () => {
      stop(); host.removeEventListener("pointermove", move); host.removeEventListener("pointerleave", leave); host.removeEventListener("pointercancel", leave);
      reduce.removeEventListener("change", preferenceChanged); fine.removeEventListener("change", preferenceChanged); document.removeEventListener("visibilitychange", preferenceChanged);
    };
  }, []);
  return <span ref={surface} className={`ds-honor-art${muted ? " ds-honor-art-unearned" : ""}`} style={{ width: size, height: size }}><img ref={artwork} src={src} srcSet={srcSet} sizes={`${size}px`} alt={alt} width={size} height={size} loading="lazy" decoding="async" /></span>;
}
