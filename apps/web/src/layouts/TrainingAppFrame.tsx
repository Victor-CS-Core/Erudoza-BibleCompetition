import { ProfileAvatar } from "../features/profile/ProfileAvatar";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { api } from "../api/client";
import { ErudozaWordmark } from "../components/brand/ErudozaWordmark";
import { PathfinderBackdrop } from "../components/brand/PathfinderBackdrop";
import { AppIcon } from "../components/AppIcon";
import { Button, Notice } from "../components/ui";
import { CommandCenter } from "../components/navigation/CommandCenter";
import { NavigationMenu } from "../components/navigation/NavigationMenu";
import { currentDestination, navigation, type Destination } from "../components/navigation/destinations";
import { InstallApp } from "../features/install/InstallApp";
import { CoffeeFooter, CoffeeWidget } from "../features/support/CoffeeWidget";
import "../styles/command-center.css";

export function TrainingAppFrame({ coach = false }: { coach?: boolean }) {
  const { me } = useAuth();
  return <CommandFrame key={`${me?.organizationId}:${me?.userId}:${coach}`} coach={coach} />;
}
function CommandFrame({ coach }: { coach: boolean }) {
  const { me, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const canSwitch = me?.kind === "Adult" && (me.role === "Owner" || me.role === "Admin");
  const seasonStorageKey = `erudoza:learner-season:${me?.organizationId}:${me?.userId}`;
  const selectedSeason = params.get("seasonId");
  let rememberedSeason: string | null = null;
  try { rememberedSeason = sessionStorage.getItem(seasonStorageKey); } catch { /* Storage is optional. */ }
  const pathSeason = coach ? location.pathname.match(/^\/admin\/seasons\/([^/]+)/)?.[1] : undefined;
  const switchSeason = (pathSeason && pathSeason !== "new" ? pathSeason : null) ?? selectedSeason ?? rememberedSeason;
  useEffect(() => { if (selectedSeason) { try { sessionStorage.setItem(seasonStorageKey, selectedSeason); } catch { /* Storage is optional. */ } } }, [seasonStorageKey, selectedSeason]);
  const items = navigation(coach, selectedSeason, canSwitch);
  const active = currentDestination(items, location.pathname, location.search);
  const route = location.pathname + location.search + location.hash;
  const [commandRoute, setCommandRoute] = useState<string | null>(null);
  const commandOpen = commandRoute === route;
  const commandOpener = useRef<HTMLElement | null>(null);
  const openCommand = (opener: HTMLElement) => { commandOpener.current = opener; setCommandRoute(route); };
  const closeCommand = useCallback(() => {
    setCommandRoute(null);
    requestAnimationFrame(() => { if (commandOpener.current?.isConnected) commandOpener.current.focus(); });
  }, []);
  const shortcuts = useRef<HTMLElement>(null);
  const [expanded, setExpanded] = useState<string[]>([]);
  const storageKey = `erudoza:pins:${me?.organizationId}:${me?.userId}:${coach ? "coach" : "student"}`;
  const [pinned, setPinned] = useState<string[]>(() => {
    try { const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "null"); if (Array.isArray(saved)) return [...new Set(saved.filter((id): id is string => typeof id === "string" && items.some(item => item.id === id)))]; } catch { /* Browser storage can be unavailable. */ }
    return coach ? items.filter(item => item.id !== "profile").map(item => item.id) : ["home", "study", "honors"];
  });
  const visibleShortcuts = active && !pinned.includes(active.id) ? [...pinned, active.id] : pinned;
  const mobileIds = coach ? ["overview", "seasons", "students"] : ["home", "study", "honors"];
  const mobileActive = !coach && ["review", "simulation"].includes(active?.id ?? "") ? "study" : active?.id;
  const mobileItems = mobileIds.map(id => items.find(item => item.id === id)!);
  useEffect(() => {
    const nav = shortcuts.current;
    if (!nav) return;
    const revealCurrent = () => {
      const current = nav.querySelector<HTMLAnchorElement>('a[aria-current="page"]')?.parentElement;
      if (!current) return;
      const view = nav.getBoundingClientRect(), item = current.getBoundingClientRect();
      if (item.left < view.left) nav.scrollLeft -= view.left - item.left;
      else if (item.right > view.right) nav.scrollLeft += item.right - view.right;
    };
    revealCurrent();
    let width = nav.getBoundingClientRect().width;
    const onResize = () => {
      const nextWidth = nav.getBoundingClientRect().width;
      if (nextWidth === width) return;
      width = nextWidth;
      revealCurrent();
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [active?.id, pinned]);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState("");
  const seasonId = coach ? location.pathname.match(/^\/admin\/seasons\/([^/]+)/)?.[1] : undefined;
  const season = useQuery({ queryKey: ["season", me?.organizationId, seasonId], queryFn: () => api.season(me!.organizationId, seasonId!), enabled: !!me && !!seasonId && seasonId !== "new" });
  const focused = !coach && location.pathname === "/student/study";
  const togglePin = (id: string) => setPinned(previous => {
    const next = previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id];
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Pins still work for the current visit. */ }
    return next;
  });
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); if (commandRoute === route) closeCommand(); else { commandOpener.current = document.activeElement as HTMLElement | null; setCommandRoute(route); } } };
    window.addEventListener("keydown", shortcut); return () => window.removeEventListener("keydown", shortcut);
  }, [route, commandRoute, closeCommand]);
  useEffect(() => {
    if (!location.hash) return;
    let id: string; try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; }
    const reveal = () => { const target = document.getElementById(id); if (!target) return false; target.scrollIntoView({ block: "start" }); target.tabIndex = -1; target.focus({ preventScroll: true }); return true; };
    if (reveal()) return;
    const observer = new MutationObserver(() => { if (reveal()) observer.disconnect(); });
    observer.observe(document.getElementById("training-main") ?? document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [route, location.hash]);
  const signOut = async () => {
    setSigningOut(true); setError("");
    try { await logout(); navigate("/login"); }
    catch { setError("Could not sign out. Please try again."); }
    finally { setSigningOut(false); }
  };
  const home = coach ? "/admin" : `/student${selectedSeason ? `?seasonId=${encodeURIComponent(selectedSeason)}` : ""}`;
  const seasonItems: Destination[] = seasonId && seasonId !== "new" ? [
    { id: "details", label: "Overview", to: `/admin/seasons/${seasonId}?step=details`, icon: "home" },
    { id: "passages", label: "Passages", to: `/admin/seasons/${seasonId}?step=passages`, icon: "book" },
    { id: "students", label: "Students", to: `/admin/seasons/${seasonId}?step=students`, icon: "users" },
    { id: "review", label: "Readiness", to: `/admin/seasons/${seasonId}?step=review`, icon: "flag" },
  ] : [];
  const contextItems = seasonItems.length ? seasonItems : active?.children ?? [];
  const sectionLabel = seasonItems.length ? season.data?.name ?? "Season" : active?.label ?? (coach ? "Coach workspace" : "Training");
  const currentStep = params.get("step") ?? ((season.data?.scopeUnitCount ?? 0) > 0 ? "students" : "passages");
  const contextCurrent = (item: Destination) => {
    if (seasonItems.length) return item.id === currentStep && !location.pathname.endsWith("progress");
    const target = new URL(item.to, "https://erudoza.local");
    if (target.pathname !== location.pathname) return false;
    return location.hash ? target.hash === location.hash : item.id === contextItems.find(entry => new URL(entry.to, "https://erudoza.local").pathname === location.pathname)?.id;
  };
  const searchLabel = coach ? "Search sections, students, or actions" : "Search sections, seasons, or actions";
  return <div className={`training-app command-app ${coach ? "training-coach" : "training-learner"} ${focused ? "training-focused" : ""}`} data-testid={coach ? "coach-app-shell" : "learner-app-shell"}>
    <CoffeeWidget enabled={coach && me?.kind === "Adult"} accountKey={`${me?.organizationId}:${me?.userId}`} />
    <a className="training-skip" href="#training-main">Skip to content</a>
    <header className="command-masthead"><div className="command-masthead-inner">
      <Link to={home} className="command-brand" aria-label="Erudoza home"><ErudozaWordmark compact inverted /><span>{coach ? "Coach" : "Student"}</span></Link>
      <Button variant={coach ? "secondary" : "inverse"} className="command-trigger" aria-label={searchLabel} aria-haspopup="dialog" onClick={event => openCommand(event.currentTarget)}><AppIcon name="search" /><span className="command-trigger-copy">{coach ? `${searchLabel}…` : "Find a section or season"}</span><span className="command-trigger-short">Search</span><kbd>Ctrl K</kbd></Button>
      <span className="command-academy">{me?.organizationName}</span>
      <NavigationMenu key={`account:${route}`} name="Account" label={<><ProfileAvatar userId={me?.userId ?? ""} displayName={me?.displayName ?? ""} /><span className="command-account-name">{me?.displayName}</span></>}>
        <div className="command-account-detail"><strong>{me?.displayName}</strong><span>{me?.organizationName}</span><small>{coach ? "Coach mode" : "Student mode"}</small></div>
        <Link to={coach ? "/admin/profile" : `/student/profile${selectedSeason ? `?seasonId=${encodeURIComponent(selectedSeason)}` : ""}`}><AppIcon name="users" />Your profile</Link>
        {canSwitch && <Link data-testid="switch-workspace" to={`${coach ? "/student" : "/admin"}${switchSeason ? `?seasonId=${encodeURIComponent(switchSeason)}` : ""}`}><AppIcon name="arrow" />Switch to {coach ? "Student" : "Coach"} mode</Link>}
        <Button variant="ghost" onClick={() => void signOut()} disabled={signingOut} data-testid="logout"><AppIcon name="logout" />{signingOut ? "Signing out…" : "Sign out"}</Button>
      </NavigationMenu>
    </div></header>
    {error && <Notice tone="danger">{error}</Notice>}
    <div className="command-shortcut-bar"><div className="command-shortcut-inner">
      <nav ref={shortcuts} className="command-shortcuts" aria-label={coach ? "Coach" : "Learner"} data-testid={coach ? "coach-tab-bar" : "learner-tab-bar"}>
        {visibleShortcuts.map(id => items.find(item => item.id === id)).filter((item): item is Destination => !!item).map(item => <div key={item.id} className={`command-shortcut ${active?.id === item.id ? "is-current" : ""}`}>
          <Link to={item.to} data-testid={item.testId} aria-current={active?.id === item.id ? "page" : undefined}><AppIcon name={item.icon} /><span>{item.label}</span></Link>
          <Button variant="ghost" size="compact" className="command-pin" aria-label={`${pinned.includes(item.id) ? "Unpin" : "Pin"} ${item.label}`} onClick={() => togglePin(item.id)}><AppIcon name="pin" /></Button>
        </div>)}
        {!visibleShortcuts.length && <span className="command-no-pins">Pin your favorite sections from All sections.</span>}
      </nav>
      <Button variant={coach ? "secondary" : "ghost"} className="command-all" aria-label="All sections" title="All sections" aria-haspopup="dialog" onClick={event => openCommand(event.currentTarget)}><AppIcon name="grid" /><span>All sections</span><AppIcon name="chevron" /></Button>
    </div></div>
    {(coach || focused || contextItems.length > 0) && <div className={`command-context ${coach && location.pathname === "/admin" ? "command-context-home" : ""}`}><div className="command-context-inner">
      <nav aria-label="Breadcrumb" className="command-breadcrumb" data-season={seasonItems.length > 0}><Link to={home}>{coach ? "Coach" : "Training"}</Link><span aria-hidden="true">/</span>{seasonItems.length > 0 && <><Link to="/admin/seasons">Seasons</Link><span aria-hidden="true">/</span></>}
        {contextItems.length ? <NavigationMenu key={`section:${route}`} name="Switch section" label={<span>{sectionLabel}</span>}>{contextItems.map(item => <Link key={item.id} to={item.to} aria-current={contextCurrent(item) ? "page" : undefined}><AppIcon name={item.icon} />{item.label}</Link>)}</NavigationMenu> : <span aria-current="page">{seasonId === "new" ? "Create season" : sectionLabel}</span>}
        {seasonItems.length > 0 && <><span aria-hidden="true">/</span><span aria-current="page">{location.pathname.endsWith("progress") ? "Student progress" : seasonItems.find(item => item.id === currentStep)?.label}</span></>}
      </nav>
      {focused && <Link to={home} className="command-study-back" data-testid="study-back">Back to training<AppIcon name="arrow" /></Link>}
      {!seasonItems.length && contextItems.length > 0 && <nav className="command-context-links" aria-label="Section">{contextItems.map(item => <Link key={item.id} to={item.to} aria-current={contextCurrent(item) ? "location" : undefined}>{item.label}</Link>)}</nav>}
    </div></div>}
    <div className="training-workspace pathfinder-canvas"><PathfinderBackdrop /><main id="training-main" className="training-main" data-testid={coach ? "coach-main" : "learner-main"}><Outlet /></main><footer className="training-footer"><CoffeeFooter enabled={coach && me?.kind === "Adult"} /><div className="training-install"><InstallApp /></div>{coach ? <>SCRIPTURE <span>·</span> DISCIPLESHIP <span>·</span> REAL-WORLD FAITH</> : <>Study. Master. Compete. <span>·</span> One meaningful step at a time.</>}</footer></div>
    <nav className="command-bottom-nav" aria-label="Mobile navigation">
      {mobileItems.map(item => <Link key={item.id} to={item.to} aria-current={mobileActive === item.id ? "page" : undefined}><AppIcon name={item.icon} /><span>{item.id === "home" ? "HQ" : item.label}</span></Link>)}
      <Button variant="ghost" aria-label="More" aria-current={!mobileIds.includes(mobileActive ?? "") ? "page" : undefined} aria-haspopup="dialog" onClick={event => openCommand(event.currentTarget)}><AppIcon name="grid" /><span>More</span></Button>
    </nav>
    {commandOpen && <CommandCenter items={items} coach={coach} pinned={pinned} togglePin={togglePin} expanded={expanded} toggleExpanded={id => setExpanded(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id])} onClose={closeCommand} />}
  </div>;
}
