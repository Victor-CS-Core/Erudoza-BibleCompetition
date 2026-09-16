import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { AppIcon } from "../../components/AppIcon";
import { Button } from "../../components/ui";

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** Bell in the top bar next to the profile menu. The badge reflects pending
 *  assignment updates from the coach; the panel lists their short descriptions. */
export function NotificationBell() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const list = useQuery({ queryKey: ["notifications"], queryFn: api.notifications, refetchInterval: 60_000 });
  const notifications = list.data?.notifications ?? [];
  const unreadCount = list.data?.unreadCount ?? 0;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("pointerdown", onPointerDown); document.removeEventListener("keydown", onKeyDown); };
  }, [open ]);

  const markAllRead = async () => {
    try {
      const result = await api.markNotificationsRead();
      queryClient.setQueryData(["notifications"], (previous: { notifications: { readAtUtc: string | null }[]; unreadCount: number } | undefined) => previous ? { notifications: previous.notifications.map(item => ({ ...item, readAtUtc: item.readAtUtc ?? new Date().toISOString() })), unreadCount: result.unreadCount } : previous);
    } catch { /* The badge simply stays until the next successful sync. */ }
  };

  return <div className="command-bell-wrap" ref={wrapRef}>
    <Button variant="ghost" className="command-bell ds-button-mobile-icon" aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(value => !value)}>
      <AppIcon name="bell" />
      <span className="command-bell-label">Notifications</span>
      {unreadCount > 0 && <span className="command-bell-badge" aria-hidden="true">{unreadCount > 99 ? "99+" : unreadCount}</span>}
    </Button>
    {open && <div className="command-bell-panel ds-panel" role="dialog" aria-label="Notifications">
      <div className="command-bell-header"><strong>Notifications</strong>
        {unreadCount > 0 && <Button variant="ghost" size="compact" onClick={() => void markAllRead()}>Mark all read</Button>}
      </div>
      {list.isPending ? <p className="command-bell-empty">Loading…</p>
        : list.isError ? <p className="command-bell-empty">Could not load notifications. <Button variant="secondary" size="compact" onClick={() => void list.refetch()}>Retry</Button></p>
        : !notifications.length ? <p className="command-bell-empty">You're all caught up.</p>
        : <ul className="command-bell-list">{notifications.map(item => <li key={item.id} className={item.readAtUtc ? "is-read" : "is-unread"}>
          <p>{item.summary}</p>
          <small>{item.seasonName} · {timeAgo(item.createdAtUtc)}</small>
        </li>)}</ul>}
    </div>}
  </div>;
}
