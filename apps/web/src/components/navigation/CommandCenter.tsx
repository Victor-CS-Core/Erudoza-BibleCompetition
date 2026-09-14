import { ProfileAvatar } from "../../features/profile/ProfileAvatar";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { AppIcon } from "../AppIcon";
import { Button, Input, Notice } from "../ui";
import type { Destination } from "./destinations";

type Props = { selectedSeason?: string | null; items: Destination[]; coach: boolean; pinned: string[]; togglePin: (id: string) => void; onClose: () => void; expanded: string[]; toggleExpanded: (id: string) => void };
export function CommandCenter({ items, coach, selectedSeason, pinned, togglePin, onClose, expanded, toggleExpanded }: Props) {
  const { me } = useAuth();
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All");
  const org = me?.organizationId;
  const seasons = useQuery({ queryKey: [coach ? "seasons" : "assigned-seasons", org, me?.userId], queryFn: () => coach ? api.seasons(org!) : api.assignedSeasons(), enabled: !!me, staleTime: 30_000 });
  const students = useQuery({ queryKey: ["students", org, me?.userId], queryFn: () => api.students(org!), enabled: coach && !!me, staleTime: 30_000 });
  useEffect(() => {
    const node = dialog.current!;
    node.showModal(); node.querySelector<HTMLInputElement>("input")?.focus();
    return () => { node.close(); };
  }, []);
  const needle = query.trim().toLocaleLowerCase();
  const matches = (text: string) => needle.split(/\s+/).every(word => text.toLocaleLowerCase().includes(word));
  const sections = items.flatMap(item => [item, ...(item.children ?? []).map(sub => ({ ...sub, category: item.label }))]).filter(item => matches(item.label + ("category" in item ? " " + item.category : "")));
  const seasonMatches = seasons.data?.filter(season => matches(season.name)) ?? [];
  const studentMatches = students.data?.filter(student => matches(student.displayName + " " + student.userName)) ?? [];
  const show = (type: string) => filter === "All" || filter === type;
  const hasResults = show("Sections") && sections.length > 0 || show("Seasons") && seasonMatches.length > 0 || coach && show("Students") && studentMatches.length > 0;
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
  const destination = (item: Destination, subtitle?: string, userId?: string) => <div className="command-result" key={item.id}>
    <Link data-command-result aria-label={item.label} aria-describedby={subtitle ? `command-desc-${item.id}` : undefined} to={item.to} onClick={onClose}>{userId ? <ProfileAvatar userId={userId} displayName={item.label} size={32} /> : <AppIcon name={item.icon} />}<span><strong>{item.label}</strong>{subtitle && <small id={`command-desc-${item.id}`}>{subtitle}</small>}</span><AppIcon name="arrow" /></Link>
    {items.some(root => root.id === item.id && !root.searchOnly) && <Button size="compact" variant="ghost" className="command-pin" aria-label={`${pinned.includes(item.id) ? "Unpin" : "Pin"} ${item.label}`} aria-pressed={pinned.includes(item.id)} onClick={() => togglePin(item.id)}><AppIcon name="pin" /></Button>}
  </div>;
  return <dialog className="command-dialog" ref={dialog} aria-labelledby="command-title" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === dialog.current) { const rect = dialog.current.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); } }} onKeyDown={keyboard}>
    <div className="command-dialog-heading"><h2 id="command-title">Command center</h2><Button variant="ghost" size="compact" aria-label="Close command center" onClick={onClose}><AppIcon name="close" /></Button></div>
    <div className="command-search-field"><AppIcon name="search" /><Input type="search" aria-label="Search navigation" placeholder={coach ? "Search sections, students, or actions…" : "Search sections, seasons, or actions…"} value={query} onChange={event => setQuery(event.target.value)} /><kbd>Esc</kbd></div>
    <div className="command-filter" role="group" aria-label="Search categories">{["All", "Sections", "Seasons", ...(coach ? ["Students"] : [])].map(type => <Button key={type} variant="ghost" size="compact" aria-pressed={filter === type} onClick={() => setFilter(type)}>{type}</Button>)}</div>
    <div className="command-results">
      {(seasons.isError || students.isError) && <Notice tone="danger">Some results could not load. Sections are still available. <Button size="compact" variant="secondary" onClick={() => { void seasons.refetch(); if (coach) void students.refetch(); }}>Retry results</Button></Notice>}
      {show("Sections") && (!needle || sections.length > 0) && <section aria-label="Sections"><h3>Navigate</h3>{needle ? sections.map(item => destination(item, "category" in item ? String(item.category) : "Section")) : items.map(item => <div className="command-group" key={item.id}>{destination(item)}{item.children && <><Button className="command-expand" variant="ghost" size="compact" aria-label={`${expanded.includes(item.id) ? "Hide" : "Show"} ${item.label} options`} aria-expanded={expanded.includes(item.id)} onClick={() => toggleExpanded(item.id)}><AppIcon name="chevron" />{expanded.includes(item.id) ? "Hide options" : "Show options"}</Button>{expanded.includes(item.id) && <div className="command-nested">{item.children.map(sub => destination(sub))}</div>}</>}</div>)}</section>}
      {show("Seasons") && <section aria-label="Season results"><h3>{needle ? "Matching seasons" : "Your seasons"}</h3>{seasons.isPending ? <p role="status">Loading seasons…</p> : seasonMatches.length ? seasonMatches.slice(0, 20).map(season => destination({ id: season.id, label: season.name, to: coach ? `/admin/seasons/${season.id}` : `/student?seasonId=${encodeURIComponent(season.id)}`, icon: "flag" }, "Season")) : !seasons.isError && <p>No matching seasons.</p>}</section>}
      {coach && show("Students") && <section aria-label="Student results"><h3>{needle ? "Matching students" : "Students"}</h3>{students.isPending ? <p role="status">Loading students…</p> : studentMatches.length ? studentMatches.slice(0, 20).map(student => destination({ id: student.userId, label: student.displayName, to: `/admin/assignments?studentId=${encodeURIComponent(student.userId)}${selectedSeason ? `&seasonId=${encodeURIComponent(selectedSeason)}` : ""}`, icon: "users" }, `${student.userName} · Manage assignments`, student.userId)) : !students.isError && <p>No matching students.</p>}</section>}
      {!hasResults && needle && !seasons.isPending && !(coach && students.isPending) && <p className="command-empty">No results for “{query}”. Try a section, season, or student name.</p>}
      {(seasonMatches.length > 20 || studentMatches.length > 20) && <p>Showing the first 20 matches per category. Refine your search for more specific results.</p>}
    </div>
    <footer className="command-dialog-foot"><span>Pin sections for one-click access.</span><span>↑ ↓ Navigate <kbd>Enter</kbd> Open</span></footer>
  </dialog>;
}