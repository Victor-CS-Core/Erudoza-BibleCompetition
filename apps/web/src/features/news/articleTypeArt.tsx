import type { PbeNewsArticleType } from "../../api/types";
import "./article-type-art.css";

/** The four predefined article kinds, in the order the editor offers them. */
export const PBE_NEWS_TYPES: { value: PbeNewsArticleType; label: string }[] = [
  { value: "competition", label: "Competition" },
  { value: "study-material", label: "Study material" },
  { value: "rule-update", label: "Rule update" },
  { value: "announcement", label: "Announcement" },
];

const KNOWN_TYPES = new Set<string>(PBE_NEWS_TYPES.map(entry => entry.value));

/** Coerce any stored value to a known type; old records without a type read as "announcement". */
export function normalizeArticleType(type?: string | null): PbeNewsArticleType {
  return type && KNOWN_TYPES.has(type) ? (type as PbeNewsArticleType) : "announcement";
}

export function articleTypeLabel(type?: string | null): string {
  const value = normalizeArticleType(type);
  return PBE_NEWS_TYPES.find(entry => entry.value === value)!.label;
}

function TypeIcon({ type }: { type: PbeNewsArticleType }) {
  const common = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;
  switch (type) {
    case "competition":
      return <svg {...common}><path d="M7 4h10v4.5a5 5 0 0 1-10 0V4z" /><path d="M7 5H4.5A1.5 1.5 0 0 0 6 9.5H7" /><path d="M17 5h2.5A1.5 1.5 0 0 1 18 9.5h-1" /><path d="M12 13.5V16" /><path d="M8.5 20h7" /><path d="M10 16.5h4" /></svg>;
    case "study-material":
      return <svg {...common}><path d="M12 6.5C10 5 7.2 4.5 4.5 4.5v13.5c2.7 0 5.5.5 7.5 2 2-1.5 4.8-2 7.5-2V4.5c-2.7 0-5.5.5-7.5 2z" /><path d="M12 6.5V20" /></svg>;
    case "rule-update":
      return <svg {...common}><path d="M8 5h10a2 2 0 0 1 0 4H8a2 2 0 0 1 0-4z" /><path d="M8 5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2" /><path d="M8 9a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2" /><path d="M18 5v10" /><path d="M11.5 7h5" /></svg>;
    case "announcement":
      return <svg {...common}><path d="M4 10.5v3l3.5.6v-4.2L4 10.5z" /><path d="M7.5 9.9L18 5v13l-10.5-4.9" /><path d="M18 8.7a3.5 3.5 0 0 1 0 6.6" /><path d="M9.5 15.5V19a1.5 1.5 0 0 0 3 0v-2.6" /></svg>;
  }
}

/**
 * Thin painterly art header identifying the article kind at a glance.
 * Purely decorative (the adjacent text kicker carries the label for assistive tech).
 */
export function ArticleTypeArt({ type, className = "" }: { type?: string | null; className?: string }) {
  const normalized = normalizeArticleType(type);
  return <div className={`article-art-strip ${className}`} data-type={normalized} aria-hidden="true">
    <span className="article-art-label"><TypeIcon type={normalized} />{articleTypeLabel(normalized)}</span>
    <span className="article-art-motif"><TypeIcon type={normalized} /></span>
  </div>;
}
