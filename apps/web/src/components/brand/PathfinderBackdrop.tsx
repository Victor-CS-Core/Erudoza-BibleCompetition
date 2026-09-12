import type { CSSProperties } from "react";
import { useLocation } from "react-router-dom";
import "./pathfinder-backdrop.css";

const artworks = {
  camp: { name: "camp", side: "right", file: "pathfinder-corner-v1-960.webp" },
  trail: { name: "trail", side: "left", file: "trail-navigation-left-v1-960.webp" },
  campcraft: { name: "campcraft", side: "right", file: "campcraft-right-v1-960.webp" },
  notes: { name: "notes", side: "left", file: "field-notes-left-v1-960.webp" },
} as const;

/** Page families keep their approved artwork when filters, seasons, or steps change. */
export function pathfinderArtworkForRoute(path: string) {
  const pathname = path.split(/[?#]/, 1)[0].replace(/\/+$/, "") || "/";
  if (pathname === "/" || pathname === "/login" || pathname === "/student" || /^\/student\/sessions\/[^/]+\/recap$/.test(pathname)) return artworks.camp;
  if (pathname === "/forgot-password" || pathname === "/student/study") return artworks.trail;
  if (pathname === "/signup" || pathname === "/student/progress" || /^\/admin\/seasons\/[^/]+\/students\/[^/]+\/progress$/.test(pathname)) return artworks.campcraft;
  if (pathname === "/admin" || pathname === "/student/honors" || pathname === "/join-coach") return artworks.notes;
  if (/^\/admin\/seasons(?:\/|$)/.test(pathname)) return artworks.trail;
  if (/^\/admin\/(?:students|design-system)(?:\/|$)/.test(pathname) || /^\/student\/practice(?:\/|$)/.test(pathname)) return artworks.campcraft;
  if (/^\/admin\/(?:assignments|practice)(?:\/|$)/.test(pathname)) return artworks.camp;
  if (/^\/admin(?:\/|$)/.test(pathname)) return artworks.notes;
  return artworks.trail;
}

/** Mount inside a pathfinder-canvas; this layer never occupies layout or receives input. */
export function PathfinderBackdrop() {
  const { pathname } = useLocation();
  const artwork = pathfinderArtworkForRoute(pathname);
  return <div
    className="pathfinder-backdrop"
    aria-hidden="true"
    data-artwork={artwork.name}
    data-corner={artwork.side}
    style={{ "--pathfinder-image": `url("/assets/training/corners/${artwork.file}")` } as CSSProperties}
  />;
}
