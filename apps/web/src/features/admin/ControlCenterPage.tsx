import { Component, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Badge, Button, EmptyState, Input, Notice, Select, Textarea, useToast } from "../../components/ui";
import { TrainingDialog } from "../../components/ui/TrainingDialog";
import { AppIcon, type IconName } from "../../components/AppIcon";
import {
  controlCenterApi, MASTER_ADMIN_EMAIL, SUPPORT_ADDRESS,
  type ClubsData, type ContentData, type DigestData, type FunnelData, type OverviewData,
  type SeasonsData, type SupportData, type SupportInboxEntry, type SupportTicket, type SystemData, type TicketFilter, type TicketStatus, type UsersData,
} from "../../api/controlCenter";
import { ApiError } from "../../api/client";
import "./control-center.css";

/* Control Center shell + tabs, restyled to the approved control-center
 * reference design (fixed navy sidebar / branded top bar / bottom nav).
 * Data, endpoints and the master-admin gate are unchanged from the first
 * build; this file owns layout and interaction only. */

const TABS = [
  { id: "overview", label: "Overview", short: "Overview", icon: "grid", blurb: "Participation, practice and follow-up across all clubs." },
  { id: "users", label: "Users & clubs", short: "Clubs", icon: "users", blurb: "Account growth and participation across your clubs." },
  { id: "content", label: "Content", short: "Content", icon: "book", blurb: "Material reviews, publishing and season activity." },
  { id: "support", label: "Support & tickets", short: "Support", icon: "chat", blurb: "Triage incoming email and follow requests through resolution." },
  { id: "system", label: "System", short: "System", icon: "server", blurb: "Service health, configuration and club administration." },
] as const;
type TabId = (typeof TABS)[number]["id"];

// Defensive by design: a missing or malformed aggregate renders as 0
// instead of throwing the whole tab into the app error boundary (the
// Nov 24 production Content-tab crash was num(undefined) after a
// client/server field-name drift).
const num = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) ? n : 0).toLocaleString("en-US");
/** Singular label for a count of exactly 1 ("1 session", "1 member"). */
const plural = (n: number | null | undefined, one: string, many?: string) => (typeof n === "number" && n === 1 ? one : (many ?? `${one}s`));
const fmtDate = (iso: string | null) => iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
const fmtDateTime = (iso: string | null) => iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
const dayDate = (day: string) => new Date(`${day}T12:00:00`);
const fmtMonthDay = (day: string) => dayDate(day).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const fmtDayLong = (day: string) => dayDate(day).toLocaleDateString("en-US", { month: "long", day: "numeric" });
const initials = (name: string | null | undefined) => (name ?? "").split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]!.toUpperCase()).join("") || "?";
const TINTS = ["cc-tint-0", "cc-tint-1", "cc-tint-2"] as const;
const STRIP_COLORS = ["#169985", "#6e9bd5", "#a78cb9"];

/** Readable zero-based axis ceiling: 48 sessions peak at 50, like the reference. */
function axisCeiling(max: number): number {
  if (max <= 0) return 10;
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 10]) if (m * pow >= max) return m * pow;
  return 10 * pow;
}
const fmtTick = (n: number) => Number.isInteger(n) ? String(n) : n.toFixed(1);

function PanelHead({ title, note }: { title: string; note?: string }) {
  return (
    <div className="cc-panel-head">
      <div>
        <h2>{title}</h2>
        {note && <p>{note}</p>}
      </div>
    </div>
  );
}

function PanelSkeleton({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div className="cc-skel" role="status" aria-label={label}>
      <span className="cc-sr">{label}</span>
      <div className="cc-skel-bar cc-skel-title" aria-hidden="true" />
      {Array.from({ length: rows }, (_, i) => <div key={i} className={`cc-skel-bar${i === rows - 1 ? " cc-skel-short" : ""}`} aria-hidden="true" />)}
    </div>
  );
}

/** Render-throw isolation for one panel. QueryState already isolates query
 *  ERRORS; this boundary isolates throws while RENDERING a successful
 *  payload (the Nov 24 Content-tab crash class: a field-name drift made a
 *  formatter throw inside the panel, and with no boundary here it escaped
 *  to the app error page and took the whole tab down). A drifted panel now
 *  degrades to its own error box with a retry; sibling panels keep working. */
class PanelBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="cc-panel-error">
          <Notice tone="danger">This section could not be displayed. The rest of the page is unaffected.</Notice>
          <Button variant="secondary" size="compact" onClick={() => this.setState({ error: null })}>Retry</Button>
        </div>
      );
    }
    return this.props.children;
  }
}

function QueryState<T>({ query, label, skeleton, children }: { query: UseQueryResult<T>; label: string; skeleton?: ReactNode; children: (data: T) => ReactNode }) {
  if (query.isPending) return <>{skeleton ?? <div className="cc-panel"><PanelSkeleton label={label} /></div>}</>;
  if (query.isError || !query.data) {
    return (
      <div className="cc-panel-error">
        <Notice tone="danger">This section could not be loaded. The rest of the page is unaffected.</Notice>
        <Button variant="secondary" size="compact" onClick={() => void query.refetch()}>Retry</Button>
      </div>
    );
  }
  return <PanelBoundary>{children(query.data)}</PanelBoundary>;
}

function DeltaFoot({ current, previous }: { current: number; previous: number }) {
  const diff = current - previous;
  if (diff === 0) return <div className="cc-foot">No change vs. last week</div>;
  return <div className="cc-foot"><span className={diff > 0 ? "cc-up" : "cc-down"}>{diff > 0 ? "↗" : "↘"} {num(Math.abs(diff))}</span> vs. last week</div>;
}

function Metric({ icon, tile, label, value, children }: { icon: IconName; tile: string; label: string; value: string; children: ReactNode }) {
  return (
    <div className="cc-metric">
      <div className="cc-mhead"><span className={`cc-tile cc-tile-${tile}`}><AppIcon name={icon} /></span>{label}</div>
      <b className="cc-mval">{value}</b>
      {children}
    </div>
  );
}

/* ---------------- Overview ---------------- */

function PracticeChart({ data }: { data: OverviewData }) {
  const [range, setRange] = useState<7 | 14>(14);
  const full = data.chart;
  const series = range === 7 ? full.slice(-7) : full;
  const axisMax = axisCeiling(Math.max(0, ...full.map(d => d.sessions)));
  const today = full[full.length - 1]?.day;
  const first = series[0], last = series[series.length - 1];
  const period = first && last
    ? (first.day.slice(0, 7) === last.day.slice(0, 7)
      ? `${fmtMonthDay(first.day)}–${dayDate(last.day).getDate()}, ${dayDate(last.day).getFullYear()}`
      : `${fmtMonthDay(first.day)} – ${fmtMonthDay(last.day)}, ${dayDate(last.day).getFullYear()}`)
    : "";
  return (
    <section className="cc-panel cc-chart-panel" aria-label="Practice activity">
      <svg className="cc-contours" aria-hidden="true" viewBox="0 0 320 180" fill="none" stroke="#8ddabe" strokeWidth="0.8">
        <path d="M200,20 C240,60 210,90 250,120 C275,140 270,165 300,178" />
        <path d="M215,12 C255,55 228,88 268,118 C295,138 292,160 320,172" />
        <path d="M185,28 C222,66 195,96 232,126 C256,146 250,168 282,180" />
        <path d="M232,6 C268,48 244,82 282,110 C306,128 304,150 330,160" />
        <path d="M168,38 C202,72 178,102 214,130 C238,150 232,170 262,182" />
        <path d="M250,2 C282,42 260,76 296,102 C318,118 318,140 344,150" />
      </svg>
      <div className="cc-panel-head">
        <div>
          <h2>Practice activity</h2>
          <p>Daily sessions across all clubs</p>
        </div>
        <div className="cc-range" role="group" aria-label="Chart range">
          <button type="button" aria-pressed={range === 7} onClick={() => setRange(7)}>7D</button>
          <button type="button" aria-pressed={range === 14} onClick={() => setRange(14)}>14D</button>
        </div>
      </div>
      <div className="cc-chart-meta"><b>{num(data.sessionsToday)}</b> {plural(data.sessionsToday, "session")} today</div>
      <div className="cc-plot">
        <div className="cc-axis" aria-hidden="true"><span>{fmtTick(axisMax)}</span><span>{fmtTick(axisMax / 2)}</span><span>0</span></div>
        <div className="cc-plotbars" role="group" aria-label="Daily practice sessions">
          {series.map(d => (
            <div className="cc-day" key={d.day} title={`${fmtDayLong(d.day)} · ${d.sessions} ${plural(d.sessions, "session")}`}>
              <span className="cc-sr">{fmtDayLong(d.day)}, {d.sessions} {plural(d.sessions, "session")}</span>
              <div className="cc-barwell" aria-hidden="true">
                <div className={`cc-bar${d.day === today ? " cc-bar-today" : ""}`} style={{ height: `${(d.sessions / axisMax) * 100}%` }}>
                  <span className="cc-bar-value">{d.sessions}</span>
                </div>
              </div>
              <small aria-hidden="true">{dayDate(d.day).getDate()}</small>
            </div>
          ))}
        </div>
      </div>
      <div className="cc-chart-foot">
        <span>{period}</span>
        <span className="cc-legend"><i className="cc-swatch cc-swatch-prior" />Prior days&nbsp;&nbsp;<i className="cc-swatch cc-swatch-today" />Today</span>
      </div>
    </section>
  );
}

function TodayByClub({ data }: { data: OverviewData }) {
  const total = data.todayByClub.reduce((sum, club) => sum + club.sessions, 0);
  return (
    <section className="cc-panel" aria-label="Today by club">
      <PanelHead title="Today by club" note="Practice session breakdown" />
      {data.todayByClub.length === 0
        ? <p className="cc-empty-line">No practice sessions recorded yet today.</p>
        : (
          <>
            <div className="cc-total"><b>{num(total)}</b> {plural(total, "session")}</div>
            <div className="cc-strip" aria-hidden="true">
              {data.todayByClub.map((club, i) => <i key={club.orgId} style={{ flex: Math.max(0, club.sessions), background: STRIP_COLORS[i % STRIP_COLORS.length] }} />)}
            </div>
            {data.todayByClub.map((club, i) => (
              <div className="cc-club" key={club.orgId}>
                <span className={`cc-crest ${TINTS[i % TINTS.length]}`}>{initials(club.name)}</span>
                <div>
                  <div className="cc-club-name">{club.name}</div>
                  <div className="cc-detail">{num(club.students)} {plural(club.students, "student")}</div>
                </div>
                <b className="cc-count">{num(club.sessions)}</b>
              </div>
            ))}
          </>
        )}
    </section>
  );
}

function DigestPanel() {
  const digest = useQuery({ queryKey: ["control-center", "digest"], queryFn: controlCenterApi.digest });
  return (
    <section className="cc-panel" aria-label="Weekly digest">
      <QueryState query={digest} label="Loading digest…" skeleton={<PanelSkeleton label="Loading digest…" rows={3} />}>
        {(data: DigestData) => data.digest == null
          ? (
            <>
              <PanelHead title="Weekly digest" note="Composed Mondays at 10:00 UTC" />
              <EmptyState title="No digest yet" description="The first digest is composed by the Monday 10:00 UTC run and stored here. It is also emailed to the master admin." />
            </>
          )
          : (
            <>
              <PanelHead title="Weekly digest" note={`${fmtMonthDay(data.digest.weekStart)}–${dayDate(data.digest.weekEnd).getDate()}, ${dayDate(data.digest.weekEnd).getFullYear()}`} />
              <div className="cc-digest-grid">
                <div><span>New users</span><b>{num(data.digest.newUsers)}</b></div>
                <div><span>Active users</span><b>{num(data.digest.activeUsers)}</b></div>
                <div><span>Active clubs</span><b>{num(data.digest.activeClubs)}</b></div>
                <div><span>Sessions</span><b>{num(data.digest.sessions)}</b></div>
                <div><span>XP awarded</span><b>{num(data.digest.xpAwarded)}</b></div>
                <div><span>Open tickets</span><b>{num(data.digest.openTickets)}</b></div>
                <div><span>Server errors</span><b>{num(data.digest.errors7d)}</b></div>
              </div>
              <div className="cc-detail cc-digest-note">Composed Mondays at 10:00 UTC</div>
            </>
          )}
      </QueryState>
    </section>
  );
}

interface AttentionItem { key: string; tone: "warning" | "danger"; count: number; label: string; to: string }

function AttentionPanel() {
  return (
    <PanelBoundary>
      <AttentionPanelBody />
    </PanelBoundary>
  );
}

function AttentionPanelBody() {
  const seasons = useQuery({ queryKey: ["control-center", "seasons"], queryFn: controlCenterApi.seasons });
  const content = useQuery({ queryKey: ["control-center", "content"], queryFn: controlCenterApi.content });
  const support = useQuery({ queryKey: ["control-center", "support"], queryFn: () => controlCenterApi.support() });
  const system = useQuery({ queryKey: ["control-center", "system"], queryFn: controlCenterApi.system });
  const queries = [seasons, content, support, system];
  const items: AttentionItem[] = [];
  if (support.data) {
    const stale = support.data.tickets.filter(t => t.status !== "Resolved" && t.ageHours >= 24 * 7);
    if (support.data.counts.stale7d > 0) items.push({ key: "stale", tone: "danger", count: support.data.counts.stale7d, label: "Tickets open 7+ days", to: support.data.counts.stale7d === 1 && stale.length === 1 ? `?tab=support&ticketStatus=open&focus=ticket-${stale[0].number}` : "?tab=support&ticketStatus=open" });
    const agingCount = support.data.counts.aging48h - support.data.counts.stale7d;
    const aging = support.data.tickets.filter(t => t.status !== "Resolved" && t.ageHours >= 48 && t.ageHours < 24 * 7);
    if (agingCount > 0) items.push({ key: "aging", tone: "warning", count: agingCount, label: "Tickets open 48h+", to: agingCount === 1 && aging.length === 1 ? `?tab=support&ticketStatus=open&focus=ticket-${aging[0].number}` : "?tab=support&ticketStatus=open" });
  }
  if (content.data && content.data.proposalsPending > 0) items.push({ key: "drafts", tone: "warning", count: content.data.proposalsPending, label: "Material drafts awaiting review", to: "?tab=content&focus=materials" });
  if (seasons.data && seasons.data.openDisputes > 0) items.push({ key: "disputes", tone: "warning", count: seasons.data.openDisputes, label: "Open answer disputes", to: "?tab=content&focus=seasons" });
  if (system.data && system.data.errors.last24h > 0) items.push({ key: "errors", tone: "warning", count: system.data.errors.last24h, label: "Server errors in the last 24 hours", to: "?tab=system" });
  const pending = queries.some(q => q.isPending);
  const allFailed = queries.every(q => q.isError);
  return (
    <section className="cc-panel" aria-label="Needs attention">
      <PanelHead title="Needs attention" note="Open items across the workspace" />
      {items.length > 0
        ? (
          <div className="cc-queue">
            {items.map(item => (
              <Link key={item.key} className="cc-queue-row" to={item.to}>
                <Badge tone={item.tone}>{num(item.count)}</Badge>
                <span>{item.label}</span>
                <AppIcon name="arrow" />
              </Link>
            ))}
          </div>
        )
        : pending
          ? <PanelSkeleton label="Loading attention items…" rows={2} />
          : allFailed
            ? <p className="cc-empty-line">Attention items are unavailable right now.</p>
            : <p className="cc-empty-line cc-clear"><AppIcon name="check" /> All clear — nothing needs attention.</p>}
    </section>
  );
}

function OverviewTab() {
  const overview = useQuery({ queryKey: ["control-center", "overview"], queryFn: controlCenterApi.overview });
  const skeleton = (
    <>
      <div className="cc-metrics" role="status" aria-label="Loading overview…">
        {Array.from({ length: 4 }, (_, i) => <div key={i} className="cc-metric cc-skel-metric" aria-hidden="true"><div className="cc-skel-bar cc-skel-title" /><div className="cc-skel-bar cc-skel-value" /><div className="cc-skel-bar cc-skel-short" /></div>)}
      </div>
      <div className="cc-split">
        <div className="cc-panel"><PanelSkeleton label="Loading practice activity…" rows={4} /></div>
        <div className="cc-panel"><PanelSkeleton label="Loading clubs…" rows={3} /></div>
      </div>
    </>
  );
  return (
    <div className="cc-stack">
      <QueryState query={overview} label="Loading overview…" skeleton={skeleton}>
        {(data: OverviewData) => (
          <>
            <div className="cc-metrics">
              <Metric icon="users" tile="blue" label="Total users" value={num(data.totalUsers)}>
                {data.newThisMonth > 0
                  ? <div className="cc-foot"><span className="cc-up">↗ {num(data.newThisMonth)}</span> new this month</div>
                  : <div className="cc-foot">No new accounts this month</div>}
              </Metric>
              <Metric icon="activity" tile="mint" label="Weekly active" value={num(data.activeThisWeek)}>
                <DeltaFoot current={data.activeThisWeek} previous={data.activeLastWeek} />
              </Metric>
              <Metric icon="bolt" tile="amber" label="Sessions today" value={num(data.sessionsToday)}>
                <div className="cc-foot">Prior 13-day average · {Number.isInteger(data.sessionsDailyAverage ?? 0) ? num(data.sessionsDailyAverage) : (data.sessionsDailyAverage ?? 0).toFixed(1)}</div>
              </Metric>
              <Metric icon="star" tile="purple" label="Weekly XP" value={num(data.xpThisWeek)}>
                <DeltaFoot current={data.xpThisWeek} previous={data.xpLastWeek} />
              </Metric>
            </div>
            <div className="cc-split">
              <PanelBoundary><PracticeChart data={data} /></PanelBoundary>
              <PanelBoundary><TodayByClub data={data} /></PanelBoundary>
            </div>
          </>
        )}
      </QueryState>
      <div className="cc-split">
        <DigestPanel />
        <AttentionPanel />
      </div>
    </div>
  );
}

/* ---------------- Users & clubs ---------------- */

function UsersTab() {
  const users = useQuery({ queryKey: ["control-center", "users"], queryFn: controlCenterApi.users });
  const clubs = useQuery({ queryKey: ["control-center", "clubs"], queryFn: controlCenterApi.clubs });
  const funnel = useQuery({ queryKey: ["control-center", "funnel"], queryFn: controlCenterApi.funnel });
  return (
    <div className="cc-stack">
      <section className="cc-panel" aria-label="Club health">
        <PanelHead title="Club health" note="Weekly participation · Quiet means no XP in 7+ days." />
        <QueryState query={clubs} label="Loading club health…" skeleton={<PanelSkeleton label="Loading club health…" rows={3} />}>
          {(data: ClubsData) => data.clubs.length === 0
            ? <EmptyState title="No clubs yet" description="Club health rows appear once the first club exists." />
            : (
              <div className="cc-table-wrap">
                <table className="cc-table cc-clubtable" aria-label="Club health this week">
                  <thead><tr><th scope="col">Club</th><th scope="col">Learners</th><th scope="col">Active this week</th><th scope="col">Weekly sessions</th><th scope="col">Quiet 7+ days</th></tr></thead>
                  <tbody>
                    {data.clubs.map(club => (
                      <tr key={club.orgId}>
                        <th scope="row">{club.name}</th>
                        <td data-label="Learners">{num(club.learners)}</td>
                        <td data-label="Active this week">{num(club.activeLearners)}</td>
                        <td data-label="Weekly sessions">{num(club.sessionsThisWeek)}</td>
                        <td data-label="Quiet 7+ days">{club.quietLearners > 0 ? <Badge tone="warning">{num(club.quietLearners)} quiet</Badge> : "0"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </QueryState>
      </section>
      <div className="cc-grid">
        <section className="cc-panel" aria-label="Newest users">
          <QueryState query={users} label="Loading users…" skeleton={<PanelSkeleton label="Loading users…" rows={3} />}>
            {(data: UsersData) => (
              <>
                <PanelHead title="Newest users" note={`${num(data.clubs)} ${plural(data.clubs, "club")} with accounts`} />
                {data.newest.length === 0
                  ? <EmptyState title="No accounts yet" description="Accounts appear here as soon as the first club member signs up." />
                  : data.newest.map((user, i) => (
                    <div className="cc-data-row" key={user.id}>
                      <div className="cc-identity">
                        <span className={`cc-idpic ${TINTS[i % TINTS.length]}`}>{initials(user.displayName)}</span>
                        <div>
                          <strong>{user.displayName}</strong>
                          <small>{user.orgName} · {user.joinedAtUtc ? `Joined ${fmtDate(user.joinedAtUtc)}` : "Join date unavailable"}</small>
                        </div>
                      </div>
                      <span className="cc-row-tags">
                        <Badge tone={user.kind === "Student" ? "info" : "neutral"}>{user.role}</Badge>
                        {!user.active && <Badge tone="danger">Inactive</Badge>}
                      </span>
                    </div>
                  ))}
              </>
            )}
          </QueryState>
        </section>
        <section className="cc-panel" aria-label="Onboarding funnel">
          <PanelHead title="Onboarding funnel" note="App-wide totals by source" />
          <QueryState query={funnel} label="Loading funnel…" skeleton={<PanelSkeleton label="Loading funnel…" rows={4} />}>
            {(data: FunnelData) => {
              const top = Math.max(0, ...data.steps.map(s => s.count));
              return (
                <>
                  {data.steps.map(step => (
                    <div className="cc-funnel" key={step.key}>
                      <div className="cc-funnel-head"><b>{step.label}</b><b>{num(step.count)}</b></div>
                      <div className="cc-funnel-track" aria-hidden="true"><i style={{ width: top > 0 ? `${(step.count / top) * 100}%` : "0%" }} /></div>
                      <small>{step.source}</small>
                    </div>
                  ))}
                </>
              );
            }}
          </QueryState>
        </section>
      </div>
    </div>
  );
}

/* ---------------- Content ---------------- */

function ContentTab() {
  const content = useQuery({ queryKey: ["control-center", "content"], queryFn: controlCenterApi.content });
  const seasons = useQuery({ queryKey: ["control-center", "seasons"], queryFn: controlCenterApi.seasons });
  return (
    <div className="cc-grid">
      <section className="cc-panel" id="materials" tabIndex={-1} aria-label="Materials and news">
        <PanelHead title="Materials & news" note="Shared library across all clubs" />
        <QueryState query={content} label="Loading content…" skeleton={<PanelSkeleton label="Loading content…" rows={4} />}>
          {(data: ContentData) => (
            <>
              <div className="cc-data-row">
                <div><strong>Material drafts</strong><small>{data.proposalsOldestAtUtc ? `Oldest submitted ${fmtDate(data.proposalsOldestAtUtc)}` : "Nothing waiting"}</small></div>
                <div className="cc-right">{data.proposalsPending > 0 ? <Badge tone="warning">{num(data.proposalsPending)} awaiting review</Badge> : <b>0</b>}</div>
              </div>
              <div className="cc-data-row">
                <div><strong>Live releases</strong><small>Published to all clubs</small></div>
                <div className="cc-right"><b>{num(data.releasesLive)} {plural(data.releasesLive, "material")}</b></div>
              </div>
              <div className="cc-data-row">
                <div><strong>News</strong><small>{num(data.newsSuggestions)} watcher {plural(data.newsSuggestions, "suggestion")} · {num(data.newsDrafts)} {plural(data.newsDrafts, "draft")} in total · Oldest suggestion {fmtDate(data.newsOldestSuggestionAtUtc)}</small></div>
                <div className="cc-right"><b>{num(data.newsPublished)} published</b></div>
              </div>
              <div className="cc-data-row">
                <div><strong>Scripture library</strong><small>New King James Version (NKJV)</small></div>
                <div className="cc-right"><b>{num(data.libraryPacks)} {plural(data.libraryPacks, "pack")} · {num(data.libraryVerses)} {plural(data.libraryVerses, "verse")}</b></div>
              </div>
            </>
          )}
        </QueryState>
      </section>
      <div className="cc-stack">
        <section className="cc-panel" aria-label="NAD watcher">
          <QueryState query={content} label="Loading watcher…" skeleton={<PanelSkeleton label="Loading watcher…" rows={2} />}>
            {(data: ContentData) => (
              <>
                <div className="cc-panel-head">
                  <div><h2>NAD watcher</h2><p>Content source monitoring</p></div>
                  <Badge tone={data.watcher ? "success" : "neutral"}>{data.watcher ? "Ran" : "No runs"}</Badge>
                </div>
                {data.watcher
                  ? (
                    <>
                      <div className="cc-data-row">
                        <div><strong>Last run</strong><small>{fmtDateTime(data.watcher.checkedAtUtc)}</small></div>
                        <div className="cc-right"><b>{num(data.watcher.mediaChecked)} items checked</b></div>
                      </div>
                      {data.watcher.notes && <p className="cc-detail">{data.watcher.notes}</p>}
                    </>
                  )
                  : <p className="cc-empty-line">No watcher run recorded yet.</p>}
              </>
            )}
          </QueryState>
        </section>
        <section className="cc-panel" id="seasons" tabIndex={-1} aria-label="Seasons and teams">
          <PanelHead title="Seasons & teams" note="Across all clubs" />
          <QueryState query={seasons} label="Loading seasons…" skeleton={<PanelSkeleton label="Loading seasons…" rows={3} />}>
            {(data: SeasonsData) => (
              <>
                {data.seasons.length === 0 && data.openDisputes === 0
                  ? <EmptyState title="No seasons yet" description="Seasons appear here when coaches create them." />
                  : (
                    <>
                      {data.seasons.map(season => (
                        <div className="cc-data-row" key={season.id}>
                          <div><strong>{season.name}</strong><small>{season.orgName} · {num(season.members)} {plural(season.members, "member")}</small></div>
                          <div className="cc-right"><Badge tone={season.status === "Active" ? "success" : "neutral"}>{season.status}</Badge></div>
                        </div>
                      ))}
                      <div className="cc-data-row">
                        <div><strong>Answer disputes</strong><small>{data.oldestDisputeAtUtc ? `Oldest waiting since ${fmtDate(data.oldestDisputeAtUtc)}` : "None open"}</small></div>
                        <div className="cc-right">{data.openDisputes > 0 ? <Badge tone="warning">{num(data.openDisputes)} open</Badge> : <b>0</b>}</div>
                      </div>
                    </>
                  )}
              </>
            )}
          </QueryState>
        </section>
      </div>
    </div>
  );
}

/* ---------------- Support & tickets ---------------- */

const TICKET_STATUSES: TicketStatus[] = ["New", "Open", "Waiting", "Resolved"];
/** Page sizes mirror worker/native/control-center.ts (TICKET_PAGE_SIZE / INBOX_PAGE_SIZE). */
const TICKET_PAGE_SIZE = 30, INBOX_PAGE_SIZE = 20;
const TICKET_FILTERS: { value: TicketFilter; label: string }[] = [
  { value: "all", label: "All tickets" },
  { value: "open", label: "Open (unresolved)" },
  { value: "New", label: "New only" },
  { value: "Open", label: "Open only" },
  { value: "Waiting", label: "Waiting only" },
  { value: "Resolved", label: "Resolved only" },
];
const filterFromParam = (value: string | null): TicketFilter => value === "open" || (TICKET_STATUSES as string[]).includes(value ?? "") ? value as TicketFilter : "all";

function ticketAge(ticket: SupportTicket): { className: string; badge: ReactNode } {
  const open = ticket.status !== "Resolved";
  if (open && ticket.ageHours >= 24 * 7) return { className: " cc-ticket-stale", badge: <Badge tone="danger">Open 7d+</Badge> };
  if (open && ticket.ageHours >= 48) return { className: " cc-ticket-aging", badge: <Badge tone="warning">Open 48h+</Badge> };
  return { className: "", badge: null };
}

type EditorState = { kind: "manual" } | { kind: "email"; entry: SupportInboxEntry };

function TicketDialog({ editor, onClose }: { editor: EditorState | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({ name: "", email: "", subject: "", body: "" });
  const [errors, setErrors] = useState<{ name?: string; email?: string; subject?: string }>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  useEffect(() => {
    if (!editor) return;
    setErrors({});
    setSubmitError(null);
    if (editor.kind === "email") {
      const entry = editor.entry;
      setForm({ name: entry.requesterName, email: entry.requesterEmail ?? "", subject: entry.subject, body: entry.body ?? entry.snippet ?? "" });
      // TrainingDialog focuses its first control (Close); move focus to the
      // primary action for the read-only conversion form instead.
      const timer = setTimeout(() => document.querySelector<HTMLElement>(".cc-dialog-actions .ds-button-primary")?.focus(), 0);
      return () => clearTimeout(timer);
    }
    setForm({ name: "", email: "", subject: "", body: "" });
    const timer = setTimeout(() => document.querySelector<HTMLElement>(".cc-dialog-form input")?.focus(), 0);
    return () => clearTimeout(timer);
  }, [editor]);
  const create = useMutation({
    mutationFn: async () => {
      if (!editor) throw new Error("No ticket is being composed.");
      if (editor.kind === "email") return controlCenterApi.createTicketFromInbox(editor.entry.id);
      return controlCenterApi.createTicketManual({
        requesterName: form.name.trim(),
        requesterEmail: form.email.trim() || undefined,
        subject: form.subject.trim(),
        body: form.body.trim() || undefined,
      });
    },
    onSuccess: result => {
      void queryClient.invalidateQueries({ queryKey: ["control-center", "support"] });
      if (result.alreadyProcessed) toast.info(`That email is already ticket #S-${result.ticket.number}.`);
      else toast.success(`Ticket #S-${result.ticket.number} created.`);
      onClose();
    },
    onError: error => setSubmitError(error instanceof ApiError ? error.message : "The ticket could not be created. Your entries are kept — try again."),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!editor || editor.kind === "email") { create.mutate(); return; }
    const next: typeof errors = {};
    if (!form.name.trim()) next.name = "Enter a value.";
    if (!form.subject.trim()) next.subject = "Enter a value.";
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) next.email = "Enter a valid email address.";
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    create.mutate();
  };
  const fromEmail = editor?.kind === "email";
  const emailEntry = editor?.kind === "email" ? editor.entry : null;
  return (
    <TrainingDialog open={editor != null} title={fromEmail ? "Make ticket from email" : "New ticket"} pending={create.isPending} onClose={onClose} className="cc-dialog">
      <form className="cc-dialog-form" noValidate onSubmit={submit}>
        <div className="cc-field">
          <label htmlFor="cc-ticket-name">Requester name</label>
          <Input id="cc-ticket-name" value={form.name} readOnly={fromEmail} required={!fromEmail} maxLength={100} autoComplete="off" aria-invalid={!!errors.name} aria-describedby={errors.name ? "cc-ticket-name-error" : undefined} onChange={event => { setForm({ ...form, name: event.target.value }); setErrors({ ...errors, name: undefined }); }} />
          {errors.name && <span className="cc-field-error" id="cc-ticket-name-error">{errors.name}</span>}
        </div>
        <div className="cc-field">
          <label htmlFor="cc-ticket-email">Requester email (optional)</label>
          <Input id="cc-ticket-email" type="email" value={form.email} readOnly={fromEmail} maxLength={254} autoComplete="off" aria-invalid={!!errors.email} aria-describedby={errors.email ? "cc-ticket-email-error" : undefined} onChange={event => { setForm({ ...form, email: event.target.value }); setErrors({ ...errors, email: undefined }); }} />
          {errors.email && <span className="cc-field-error" id="cc-ticket-email-error">{errors.email}</span>}
        </div>
        <div className="cc-field">
          <label htmlFor="cc-ticket-subject">Subject</label>
          <Input id="cc-ticket-subject" value={form.subject} readOnly={fromEmail} required={!fromEmail} maxLength={180} autoComplete="off" aria-invalid={!!errors.subject} aria-describedby={errors.subject ? "cc-ticket-subject-error" : undefined} onChange={event => { setForm({ ...form, subject: event.target.value }); setErrors({ ...errors, subject: undefined }); }} />
          {errors.subject && <span className="cc-field-error" id="cc-ticket-subject-error">{errors.subject}</span>}
        </div>
        <div className="cc-field">
          <label htmlFor="cc-ticket-details">Details (optional)</label>
          <Textarea id="cc-ticket-details" rows={3} value={form.body} readOnly={fromEmail} maxLength={3000} onChange={event => setForm({ ...form, body: event.target.value })} />
        </div>
        {submitError && <Notice tone="danger">{submitError}</Notice>}
        <div className="cc-detail">{emailEntry ? `From email · Received ${fmtDateTime(emailEntry.receivedAtUtc)} · Ticket details come from the email.` : "Added manually"}</div>
        <div className="cc-dialog-actions">
          <Button variant="secondary" onClick={onClose} disabled={create.isPending}>Cancel</Button>
          <Button type="submit" disabled={create.isPending}>{create.isPending ? "Creating…" : "Create ticket"}</Button>
        </div>
      </form>
    </TrainingDialog>
  );
}

function SupportTab({ onMakeTicket }: { onMakeTicket: (entry: SupportInboxEntry) => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  // The queue view lives in the URL (?ticketStatus=) like the tab itself, so
  // Needs-attention alerts can deep-link to the filtered queue.
  const [searchParams, setSearchParams] = useSearchParams();
  const ticketStatus = filterFromParam(searchParams.get("ticketStatus"));
  const [ticketOffset, setTicketOffset] = useState(0);
  const [inboxOffset, setInboxOffset] = useState(0);
  const chooseFilter = (value: TicketFilter) => {
    setTicketOffset(0);
    setSearchParams(prev => { const next = new URLSearchParams(prev); if (value === "all") next.delete("ticketStatus"); else next.set("ticketStatus", value); return next; }, { preventScrollReset: true });
  };
  const support = useQuery({ queryKey: ["control-center", "support", ticketStatus, ticketOffset, inboxOffset], queryFn: () => controlCenterApi.support({ ticketStatus, ticketOffset, inboxOffset }) });
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["control-center", "support"] });
  const [statusFailure, setStatusFailure] = useState<{ id: string; number: number; status: TicketStatus } | null>(null);
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TicketStatus }) => controlCenterApi.setTicketStatus(id, status),
    onSuccess: (result, variables) => {
      setStatusFailure(null);
      invalidate();
      toast.success(`#S-${result.ticket.number} marked ${variables.status}.`);
    },
    onError: (_error, variables) => {
      const ticket = support.data?.tickets.find(t => t.id === variables.id);
      setStatusFailure({ id: variables.id, number: ticket?.number ?? 0, status: variables.status });
    },
  });
  const skeleton = (
    <>
      <div className="cc-metrics" role="status" aria-label="Loading support…">
        {Array.from({ length: 4 }, (_, i) => <div key={i} className="cc-metric cc-skel-metric" aria-hidden="true"><div className="cc-skel-bar cc-skel-title" /><div className="cc-skel-bar cc-skel-value" /><div className="cc-skel-bar cc-skel-short" /></div>)}
      </div>
      <div className="cc-split">
        <div className="cc-panel"><PanelSkeleton label="Loading ticket queue…" rows={4} /></div>
        <div className="cc-panel"><PanelSkeleton label="Loading inbox…" rows={3} /></div>
      </div>
    </>
  );
  return (
    <div className="cc-stack">
      <QueryState query={support} label="Loading support…" skeleton={skeleton}>
        {(data: SupportData) => (
          <>
            <div className="cc-metrics">
              <Metric icon="mail" tile="blue" label="New emails" value={num(data.counts.newEmails)}>
                <div className="cc-foot">Inbox summary</div>
              </Metric>
              <Metric icon="chat" tile="mint" label="Open tickets" value={num(data.counts.openTickets)}>
                <div className="cc-foot">All statuses except Resolved</div>
              </Metric>
              <Metric icon="clock" tile="amber" label="Open 48h+" value={num(Math.max(0, data.counts.aging48h - data.counts.stale7d))}>
                <div className="cc-foot">Under 7 days</div>
              </Metric>
              <Metric icon="flag" tile="purple" label="Open 7d+" value={num(data.counts.stale7d)}>
                <div className="cc-foot">Needs follow-up</div>
              </Metric>
            </div>
            {!data.supportIngestConfigured && (
              <Notice tone="info">Email intake is off, so messages sent to {data.supportAddress} are not collected here automatically. Check that mailbox directly, or track a request by adding it with <strong>New ticket</strong>.</Notice>
            )}
            <div className="cc-split">
              <section className="cc-panel" aria-label="Ticket queue">
                <PanelHead title="Ticket queue" note="Requests and current status" />
                {statusFailure && (
                  <Notice tone="danger" className="cc-status-failure">
                    <span>Ticket #S-{statusFailure.number} could not be marked {statusFailure.status}. Its status is unchanged.</span>
                    <Button variant="secondary" size="compact" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: statusFailure.id, status: statusFailure.status })}>Retry</Button>
                  </Notice>
                )}
                <div className="cc-queue-tools">
                  <label>Show
                    <Select aria-label="Ticket status filter" value={ticketStatus} onChange={event => chooseFilter(event.target.value as TicketFilter)}>
                      {TICKET_FILTERS.map(filter => <option key={filter.value} value={filter.value}>{filter.label}</option>)}
                    </Select>
                  </label>
                  <span>{num(data.ticketsTotal)} {plural(data.ticketsTotal, "ticket")} in this view</span>
                </div>
                {data.tickets.length === 0
                  ? ticketStatus === "all" && data.ticketsTotal === 0
                    ? <EmptyState title="No tickets yet" description="Create a ticket from an email, or add one with New ticket." />
                    : <EmptyState title="No tickets in this view" description="No tickets match this status right now. Choose another view to see the rest of the queue." />
                  : data.tickets.map(ticket => {
                    const age = ticketAge(ticket);
                    return (
                      <article className={`cc-ticket${age.className}`} id={`ticket-${ticket.number}`} tabIndex={-1} key={ticket.id}>
                        <header><code>#S-{ticket.number}</code>{age.badge}</header>
                        <h3>{ticket.subject}</h3>
                        <small>{ticket.requesterName}{ticket.requesterEmail ? ` · ${ticket.requesterEmail}` : ""}</small>
                        <small>{ticket.source === "email" ? "From email" : "Added manually"} · Opened {fmtDateTime(ticket.createdAtUtc)}</small>
                        {ticket.body && <p>{ticket.body}</p>}
                        <label className="cc-ticket-foot">Status
                          <Select aria-label={`Status for ticket #S-${ticket.number}`} value={ticket.status} disabled={setStatus.isPending} onChange={event => setStatus.mutate({ id: ticket.id, status: event.target.value as TicketStatus })}>
                            {TICKET_STATUSES.map(status => <option key={status} value={status}>{status}</option>)}
                          </Select>
                        </label>
                      </article>
                    );
                  })}
                {data.ticketsTotal > TICKET_PAGE_SIZE && (
                  <div className="cc-pager">
                    <Button variant="secondary" size="compact" disabled={ticketOffset === 0} onClick={() => setTicketOffset(offset => Math.max(0, offset - TICKET_PAGE_SIZE))}>Newer</Button>
                    <span>Page {Math.floor(ticketOffset / TICKET_PAGE_SIZE) + 1} of {Math.ceil(data.ticketsTotal / TICKET_PAGE_SIZE)}</span>
                    <Button variant="secondary" size="compact" disabled={ticketOffset + data.tickets.length >= data.ticketsTotal} onClick={() => setTicketOffset(offset => offset + TICKET_PAGE_SIZE)}>Older</Button>
                  </div>
                )}
              </section>
              <div className="cc-stack">
                <section className="cc-panel" aria-label="Recent support email">
                  <PanelHead title="Recent support email" note={data.supportAddress} />
                  {data.inbox.length === 0
                    ? data.supportIngestConfigured
                      ? <EmptyState title="No support email yet" description={`Messages sent to ${data.supportAddress} appear here. Each one can be turned into a tracked ticket.`} />
                      : <EmptyState title="Email intake is off" description={`Messages sent to ${data.supportAddress} are not collected here automatically. Check that mailbox directly, or add a ticket with New ticket.`} />
                    : data.inbox.map(entry => (
                      <article className="cc-email" key={entry.id}>
                        <h3>{entry.subject}</h3>
                        <small>{entry.requesterName}{entry.requesterEmail ? ` · ${entry.requesterEmail}` : ""} · {fmtDateTime(entry.receivedAtUtc)}</small>
                        {entry.snippet && <p>{entry.snippet}</p>}
                        {entry.ticketNumber != null
                          ? <Badge tone="success">Ticket #S-{entry.ticketNumber}</Badge>
                          : <Button variant="secondary" size="compact" onClick={() => onMakeTicket(entry)}>Make ticket</Button>}
                      </article>
                    ))}
                  {data.inboxTotal > INBOX_PAGE_SIZE && (
                    <div className="cc-pager">
                      <Button variant="secondary" size="compact" disabled={inboxOffset === 0} onClick={() => setInboxOffset(offset => Math.max(0, offset - INBOX_PAGE_SIZE))}>Newer</Button>
                      <span>Page {Math.floor(inboxOffset / INBOX_PAGE_SIZE) + 1} of {Math.ceil(data.inboxTotal / INBOX_PAGE_SIZE)}</span>
                      <Button variant="secondary" size="compact" disabled={inboxOffset + data.inbox.length >= data.inboxTotal} onClick={() => setInboxOffset(offset => offset + INBOX_PAGE_SIZE)}>Older</Button>
                    </div>
                  )}
                </section>
                <details className="cc-panel cc-how">
                  <summary>How support works</summary>
                  <ul>
                    <li>Contact support in the app footer opens an email to {SUPPORT_ADDRESS}.</li>
                    {data.supportIngestConfigured
                    ? <li>Incoming mail is triaged in the inbox. Replies are drafted for review, and consequential answers wait for approval.</li>
                    : <li>Email intake is off, so new mail is not collected here yet — check the {data.supportAddress} mailbox directly and track requests with New ticket.</li>}
                    <li>Tickets track each request to resolution. Open tickets are flagged at 48 hours and again at 7 days.</li>
                  </ul>
                </details>
              </div>
            </div>
          </>
        )}
      </QueryState>
    </div>
  );
}

/* ---------------- System ---------------- */

const SHORTCUTS = [
  { label: "Overview", to: "/admin" },
  { label: "Students", to: "/admin/students" },
  { label: "Coaches", to: "/admin/coaches" },
  { label: "Seasons", to: "/admin/seasons" },
  { label: "Materials & news", to: "/admin/materials" },
  { label: "Answer reviews", to: "/admin/practice/reviews" },
] as const;

function SystemTab() {
  const system = useQuery({ queryKey: ["control-center", "system"], queryFn: controlCenterApi.system });
  return (
    <div className="cc-grid">
      <section className="cc-panel" aria-label="Service health">
        <QueryState query={system} label="Loading system state…" skeleton={<PanelSkeleton label="Loading system state…" rows={3} />}>
          {(data: SystemData) => (
            <>
              <div className="cc-panel-head">
                <div><h2>Service health</h2><p>Database check via /api/v1/health</p></div>
                <Badge tone={data.database === "ok" ? "success" : "danger"}>{data.database === "ok" ? "Operational" : "Check failed"}</Badge>
              </div>
              <div className="cc-data-row">
                <div><strong>Live version</strong><small>Reported by the health endpoint</small></div>
                <div className="cc-right"><code>{data.version}</code></div>
              </div>
              <div className="cc-data-row">
                <div><strong>Weekly run</strong><small>{data.cron.label}</small></div>
                <div className="cc-right"><code>{data.cron.expression}</code></div>
              </div>
              <div className="cc-data-row">
                <div><strong>Support email ingest</strong><small>{data.supportIngestConfigured ? "Ingest endpoint enabled" : "Requires an ingest token"}</small></div>
                <div className="cc-right"><Badge tone={data.supportIngestConfigured ? "success" : "neutral"}>{data.supportIngestConfigured ? "Enabled" : "Disabled"}</Badge></div>
              </div>
            </>
          )}
        </QueryState>
      </section>
      <section className="cc-panel" aria-label="Server errors">
        <QueryState query={system} label="Loading errors…" skeleton={<PanelSkeleton label="Loading errors…" rows={3} />}>
          {(data: SystemData) => (
            <>
              <PanelHead title="Server errors" note={`${num(data.errors.last24h)} in the last 24 hours · ${num(data.errors.last7d)} in the last 7 days`} />
              {data.errors.byArea.length === 0
                ? <p className="cc-empty-line">No server errors recorded in the last 7 days.</p>
                : (
                  <div className="cc-table-wrap">
                    <table className="cc-table" aria-label="Server errors by route">
                      <thead><tr><th scope="col">Route area</th><th scope="col">Last 24h</th><th scope="col">Last 7d</th></tr></thead>
                      <tbody>{data.errors.byArea.map(row => (
                        <tr key={row.area}><th scope="row">{row.area}</th><td>{num(row.last24h)}</td><td>{num(row.last7d)}</td></tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
            </>
          )}
        </QueryState>
      </section>
      <section className="cc-panel" aria-label="Configuration">
        <PanelHead title="Configuration" note="Presence checks for service credentials" />
        <QueryState query={system} label="Loading configuration…" skeleton={<PanelSkeleton label="Loading configuration…" rows={3} />}>
          {(data: SystemData) => (
            <>
              {data.secrets.map(secret => (
                <div className="cc-data-row" key={secret.name}>
                  <div><strong><code>{secret.name}</code></strong><small>Presence only — values are never shown</small></div>
                  <div className="cc-right"><Badge tone={secret.present ? "success" : "danger"}>{secret.present ? "Present" : "Missing"}</Badge></div>
                </div>
              ))}
            </>
          )}
        </QueryState>
      </section>
      <section className="cc-panel" aria-label="Club admin pages">
        <PanelHead title="Club admin pages" note="Quick actions in the existing club workspace" />
        <div className="cc-links">
          {SHORTCUTS.map(shortcut => (
            <Link key={shortcut.to} className="cc-action" to={shortcut.to}>{shortcut.label}<AppIcon name="link" /></Link>
          ))}
        </div>
      </section>
    </div>
  );
}

/* ---------------- Shell ---------------- */

export default function ControlCenterPage() {
  const [searchParams] = useSearchParams();
  const requested = searchParams.get("tab");
  const tab: TabId = TABS.some(t => t.id === requested) ? (requested as TabId) : "overview";
  const active = TABS.find(t => t.id === tab)!;
  const [editor, setEditor] = useState<EditorState | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const system = useQuery({ queryKey: ["control-center", "system"], queryFn: controlCenterApi.system });
  const support = useQuery({ queryKey: ["control-center", "support"], queryFn: () => controlCenterApi.support() });
  const openTickets = support.data?.counts.openTickets ?? 0;
  const health = system.isPending
    ? { text: "Checking service…", tone: "cc-dot-idle", label: "Service status is being checked. View System" }
    : system.isError || !system.data
      ? { text: "Service status unavailable", tone: "cc-dot-bad", label: "Service status unavailable. View System" }
      : system.data.database === "ok"
        ? { text: "Service operational", tone: "cc-dot-ok", label: "Service operational. View System" }
        : { text: "Service check failed", tone: "cc-dot-bad", label: "Service check failed. View System" };

  // Tab switches start at the top of the new section (the reference focuses
  // the section heading region by returning to the top of the page).
  useEffect(() => { mainRef.current?.scrollTo?.({ top: 0 }); }, [tab]);

  // Attention-panel deep links (?focus=<element id>) focus the target once
  // its tab has rendered it; data loads async, so retry briefly.
  const focusId = searchParams.get("focus");
  useEffect(() => {
    if (!focusId) return;
    let tries = 0;
    let frame = 0;
    const attempt = () => {
      const el = document.getElementById(focusId);
      if (el) {
        el.focus({ preventScroll: true });
        el.scrollIntoView({ block: "center" });
        return;
      }
      if (++tries < 30) frame = requestAnimationFrame(attempt);
    };
    frame = requestAnimationFrame(attempt);
    return () => cancelAnimationFrame(frame);
  }, [focusId, tab]);

  const navLink = (t: (typeof TABS)[number], label: string) => (
    <Link key={t.id} to={`?tab=${t.id}`} aria-label={t.label} aria-current={tab === t.id ? "page" : undefined}>
      <span className="cc-nav-icon"><AppIcon name={t.icon} /></span>
      <span>{label}</span>
      {t.id === "support" && openTickets > 0 && <span className="cc-nav-num">{num(openTickets)}</span>}
    </Link>
  );

  return (
    <div className="cc-root">
      <aside className="cc-side" aria-label="Erudoza Control Center">
        <div className="cc-brand">
          <img className="cc-mark" src="/brand/erudoza-patch-96.webp" srcSet="/brand/erudoza-patch-96.webp 96w, /brand/erudoza-patch-192.webp 192w" sizes="34px" alt="" width={34} height={34} />
          <span className="cc-brand-name">Erudoza</span>
        </div>
        <div className="cc-workspace">Control Center</div>
        <nav className="cc-nav" aria-label="Sections">
          {TABS.map(t => navLink(t, t.label))}
        </nav>
        <div className="cc-profile">
          <span className="cc-avatar"><AppIcon name="shield" /></span>
          <div>
            <b>Master admin</b>
            <small>{MASTER_ADMIN_EMAIL}</small>
          </div>
        </div>
      </aside>
      <div className="cc-shell">
        <header className="cc-top">
          <div className="cc-crumb">
            <AppIcon name={active.icon} /> Control Center <span className="cc-crumb-chev"><AppIcon name="chevron" /></span> <b>{active.label}</b>
          </div>
          <div className="cc-mobile-brand">
            <img className="cc-mark" src="/brand/erudoza-patch-96.webp" srcSet="/brand/erudoza-patch-96.webp 96w, /brand/erudoza-patch-192.webp 192w" sizes="24px" alt="" width={24} height={24} />
            <span>Erudoza<small>Control Center</small></span>
          </div>
          <Link className="cc-health" to="?tab=system" aria-label={health.label}>
            <span className={`cc-dot ${health.tone}`} />{health.text}
          </Link>
        </header>
        <main className="cc-main" ref={mainRef}>
          <div className="cc-main-inner">
            <header className="cc-head">
              <div>
                <h1>{active.label}</h1>
                <p>{active.blurb}</p>
              </div>
              {tab === "overview" && (
                <span className="cc-date"><AppIcon name="calendar" /> {new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</span>
              )}
              {tab === "support" && (
                <Button onClick={() => setEditor({ kind: "manual" })}><AppIcon name="plus" /> New ticket</Button>
              )}
            </header>
            {tab === "overview" && <OverviewTab />}
            {tab === "users" && <UsersTab />}
            {tab === "content" && <ContentTab />}
            {tab === "support" && <SupportTab onMakeTicket={entry => setEditor({ kind: "email", entry })} />}
            {tab === "system" && <SystemTab />}
          </div>
        </main>
      </div>
      <nav className="cc-mobile-nav" aria-label="Sections">
        {TABS.map(t => navLink(t, t.short))}
      </nav>
      <TicketDialog editor={editor} onClose={() => setEditor(null)} />
    </div>
  );
}
