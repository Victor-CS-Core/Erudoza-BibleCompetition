import { useEffect, useState } from "react";

/** The app's phone breakpoint: the same max-width the shell's bottom tab bar,
 *  dialog sheets and compact density key off in CSS. */
export const PHONE_LAYOUT_QUERY = "(max-width: 760px)";

function initialMatches(query: string): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(query).matches
    : false;
}

/**
 * Reactive media query. Returns false when matchMedia is unavailable (SSR,
 * jsdom), so components render their desktop presentation by default and only
 * switch once a real phone viewport reports in.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => initialMatches(query));
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/** True at phone widths (≤760px) — the Option D mobile-first breakpoint. */
export function usePhoneLayout(): boolean {
  return useMediaQuery(PHONE_LAYOUT_QUERY);
}
