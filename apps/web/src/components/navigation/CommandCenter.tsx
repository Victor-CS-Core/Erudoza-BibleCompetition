import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { AppIcon } from "../AppIcon";
import { Button, Input, Notice } from "../ui";
import type { Destination } from "./destinations";

type Props = { items: Destination[]; coach: boolean; onClose: () => void; expanded: string[]; toggleExpanded: (id: string) => void };

/**
 * Compass Hub: the command center groups destinations by purpose and offers a
 * quick-access row of recently visited sections instead of a pin system.
 * Individual students are never listed here; the same hub serves the coach
 * workspace and the learner (student-mode) workspace.
 */
type HubGroup = { id: string; label: string; ids: string[] };
const COACH_GROUPS: HubGroup[] = [
  { id: "manage", label: "Manage", ids: ["seasons", "students", "coaches", "assignments"] },
  { id: "practice", label: "Team practice", ids: ["practice"] },
  { id: "resources", label: "Resources", ids: ["library", "materials", "news"] },
  { id: "you", label: "You", ids: ["overview", "profile"] },
];
const STUDENT_GROUPS: HubGroup[] = [
  { id: "train", label: "Train", ids: ["home", "study", "practice", "progress"] },
  { id: "resources", label: "Resources", ids: ["news"] },
  { id: "you", label: "You", ids: ["profile", "my-assignments"] },
];
const RECENT_LIMIT = 5;

function readRecent(key: string): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (Array.isArray(saved)) return saved.filter((id): id is string => typeof id === "string");
  } catch { /* Recent sections are a convenience, not a requirement. */ }
  return [];
}

type SectionHit = Destination & { category?: string; hub: string };

export function CommandCenter({ items, coach, onClose, expanded, toggleExpanded }: Props) {
  const { me } = useAuth();
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All");
  const groups = coach ? COACH_GROUPS : STUDENT_GROUPS;
  const groupOf = (id: string) => groups.find(group => group.ids.includes(id)) ?? groups[groups.length - 1]!;
  const org = me?.organizationId;
  const recentKey = `erudoza:recent-sections:${org}:${me?.userId}:${coach ? "coach" : "student"}`;
  const [recent, setRecent] = useState<string[]>(() => readRecent(recentKey));
  const recordRecent = (id: string) => {
    setRecent(previous => {
      const next = [id, ...previous.filter(entry => entry !== id)].slice(0, RECENT_LIMIT);
      try { localStorage.setItem(recentKey, JSON.stringify(next)); } catch { /* Convenience only. */ }
      return next;
    });
  };
  const seasons = useQuery({ queryKey: [coach ? "seasons" : "assigned-seasons", org, me?.userId], queryFn: () => coach ? api.seasons(org!) : api.assignedSeasons(), enabled: !!me, staleTime: 30_000 });
  useEffect(() => {
    const node = dialog.current!;
    node.showModal(); node.querySelector<HTMLInputElement>("input")?.focus();
    return () => { node.close(); };
  }, []);
  const needle = query.trim().toLocaleLowerCase();
  const matches = (text: string) => needle.split(/\s+/).every(word => text.toLocaleLowerCase().includes(word));
  const sections: SectionHit[] = items.flatMap((item): SectionHit[] => {
    const hub = groupOf(item.id).id;
    return [{ ...item, hub }, ...(item.children ?? []).map(sub => ({ ...sub, category: item.label, hub }))];
  }).filter(item => matches(item.label + (item.category ? ` ${item.category}` : "")));
  const seasonMatches = seasons.data?.filter(season => matches(season.name)) ?? [];
  const show = (type: string) => filter === "All" || filter === type;
  const hasResults = show("Sections") && sections.length > 0 || show("Seasons") && seasonMatches.length > 0;
  const keyboard = (event: KeyboardEvent) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); return; }
    if (!["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) return;
    const results = [...dialog.current!.querySelectorAll<HTMLAnchorElement>("a[data-command-result]")];
    if (!results.length) return;
    const index = results.indexOf(document.activeElement as HTMLAnchorElement);
    if (event.key === "Enter") { if (event.target instanceof HTMLInputElement) { event.preventDefault(); results[0].click(); } return; }
    if (!(event.target instanceof HTMLInputElement) && index < 0) return;
    event.preventDefault(); results[index < 0 ? (event.key === "ArrowDown" ? 0 : results.length - 1) : (index + (event.key === "ArrowDown" ? 1 : results.length - 1)) % results.length].focus();
  };
  const destination = (item: Destination, subtitle?: string, track = false) => <div className="command-result" key={item.id}>
    <Link data-command-result aria-label={item.label} aria-describedby={subtitle ? `command-desc-${item.id}` : undefined} to={item.to} onClick={() => { if (track) recordRecent(item.id); onClose(); }}><AppIcon name={item.icon} /><span><strong>{item.label}</strong>{subtitle && <small id={`command-desc-${item.id}`}>{subtitle}</small>}</span><AppIcon name="arrow" /></Link>
  </div>;
  const recentItems = recent.map(id => items.find(item => item.id === id)).filter((item): item is Destination => !!item);
  const browseGroups = groups.map(group => ({ group, items: items.filter(item => groupOf(item.id).id === group.id) })).filter(entry => entry.items.length > 0);
  const searchGroups = groups.map(group => ({ group, items: sections.filter(item => item.hub === group.id) })).filter(entry => entry.items.length > 0);
  return <dialog className="command-dialog" ref={dialog} aria-labelledby="command-title" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === dialog.current) { const rect = dialog.current.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); } }} onKeyDown={keyboard}>
    <div className="command-dialog-heading"><h2 id="command-title">Command center</h2><Button variant="ghost" size="compact" aria-label="Close command center" onClick={onClose}><AppIcon name="close" /></Button></div>
    <div className="command-search-field"><AppIcon name="search" /><Input type="search" aria-label="Search navigation" placeholder="Search sections, seasons, or actions…" value={query} onChange={event => setQuery(event.target.value)} /><kbd>Esc</kbd></div>
    <div className="command-filter" role="group" aria-label="Search categories">{["All", "Sections", "Seasons"].map(type => <Button key={type} variant="ghost" size="compact" aria-pressed={filter === type} onClick={() => setFilter(type)}>{type}</Button>)}</div>
    <div className="command-results">
      {seasons.isError && <Notice tone="danger">Season results could not load. Sections are still available. <Button size="compact" variant="secondary" onClick={() => { void seasons.refetch(); }}>Retry results</Button></Notice>}
      {show("Sections") && !needle && recentItems.length > 0 && <section aria-label="Quick access"><h3>Quick access</h3><div className="command-quick">{recentItems.map(item => <Link key={item.id} data-command-result to={item.to} className="command-quick-item" onClick={() => { recordRecent(item.id); onClose(); }}><AppIcon name={item.icon} /><span>{item.label}</span></Link>)}</div></section>}
      {show("Sections") && !needle && browseGroups.map(({ group, items: groupItems }) => <section key={group.id} aria-label={group.label}><h3>{group.label}</h3>{groupItems.map(item => <div className="command-group" key={item.id}>{destination(item, undefined, true)}{item.children && <><Button className="command-expand" variant="ghost" size="compact" aria-label={`${expanded.includes(item.id) ? "Hide" : "Show"} ${item.label} options`} aria-expanded={expanded.includes(item.id)} onClick={() => toggleExpanded(item.id)}><AppIcon name="chevron" />{expanded.includes(item.id) ? "Hide options" : "Show options"}</Button>{expanded.includes(item.id) && <div className="command-nested">{item.children.map(sub => destination(sub, undefined, true))}</div>}</>}</div>)}</section>)}
      {show("Sections") && needle && searchGroups.map(({ group, items: groupItems }) => <section key={group.id} aria-label={group.label}><h3>{group.label}</h3>{groupItems.map(item => destination(item, item.category ?? "Section", true))}</section>)}
      {show("Seasons") && <section aria-label="Season results"><h3>{needle ? "Matching seasons" : "Your seasons"}</h3>{seasons.isPending ? <p role="status">Loading seasons…</p> : seasonMatches.length ? seasonMatches.slice(0, 20).map(season => destination({ id: season.id, label: season.name, to: coach ? `/admin/seasons/${season.id}` : `/student?seasonId=${encodeURIComponent(season.id)}`, icon: "flag" }, "Season")) : !seasons.isError && <p>No matching seasons.</p>}</section>}
      {!hasResults && needle && !seasons.isPending && <p className="command-empty">No results for “{query}”. Try a section or season name.</p>}
      {seasonMatches.length > 20 && <p>Showing the first 20 matching seasons. Refine your search for more specific results.</p>}
    </div>
    <footer className="command-dialog-foot"><span>Quick access remembers the sections you visit.</span><span>↑ ↓ Navigate <kbd>Enter</kbd> Open</span></footer>
  </dialog>;
}
