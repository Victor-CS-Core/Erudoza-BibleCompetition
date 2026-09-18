import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../api/client";
import type {
  PbeMaterialDiff,
  PbeMaterialDraftPayload,
  PbeMaterialProposal,
  PbeMaterialWatchResult,
  PbeNewsArticle,
  PbeNewsArticleInput,
  PbeNewsArticleType,
} from "../../api/types";
import { useAuth } from "../../auth/AuthContext";
import { Badge, Button, EmptyState, ExternalLinkButton, HelpTip, Input, LinkButton, LoadingState, Notice, PageHeader, Panel, Select, Textarea } from "../../components/ui";
import { ConfirmationDialog } from "../../components/ui/ConfirmationDialog";
import { ArticleTypeArt, PBE_NEWS_TYPES, articleTypeLabel, normalizeArticleType } from "../news/articleTypeArt";
import "./materials.css";

export function formatPbeYearLabel(yearLabel: string) {
  return yearLabel.replace("-", "–");
}

function formatDateTime(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** "1-33" or "1,2,3" (or a mix like "1-3,5") → sorted unique chapter numbers, or null when invalid. */
export function parseChapterList(text: string): number[] | null {
  const parts = text.split(",").map(part => part.trim()).filter(Boolean);
  if (!parts.length) return null;
  const chapters = new Set<number>();
  for (const part of parts) {
    const range = part.match(/^(\d+)\s*[-–—]\s*(\d+)$/);
    if (range) {
      const start = Number(range[1]), end = Number(range[2]);
      if (start < 1 || end < start || end > 200) return null;
      for (let n = start; n <= end; n++) chapters.add(n);
    } else if (/^\d+$/.test(part)) {
      const n = Number(part);
      if (n < 1 || n > 200) return null;
      chapters.add(n);
    } else {
      return null;
    }
  }
  return [...chapters].sort((a, b) => a - b);
}

/** Compress consecutive chapters for display: [1,2,3,5] → "1–3, 5". */
export function formatChapters(chapters: number[]): string {
  const sorted = [...chapters].sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = sorted[0], prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    if (sorted[i] === prev + 1) { prev = sorted[i]; continue; }
    ranges.push(start === prev ? String(start) : `${start}–${prev}`);
    start = sorted[i]; prev = sorted[i];
  }
  return ranges.join(", ");
}

function SourceLinks({ urls, labels }: { urls: { versesPdf?: string; commentaryPdf?: string; resourcesPage: string }; labels?: { verses?: string; commentary?: string } }) {
  return <div className="materials-sources">
    {urls.commentaryPdf && <ExternalLinkButton variant="secondary" size="compact" href={urls.commentaryPdf} target="_blank" rel="noreferrer">{labels?.commentary ?? "View original commentary"}</ExternalLinkButton>}
    {urls.versesPdf && <ExternalLinkButton variant="secondary" size="compact" href={urls.versesPdf} target="_blank" rel="noreferrer">{labels?.verses ?? "View original verses"}</ExternalLinkButton>}
    <ExternalLinkButton variant="secondary" size="compact" href={urls.resourcesPage} target="_blank" rel="noreferrer">NAD PBE resources</ExternalLinkButton>
  </div>;
}

type RosterRow = { bookKey: string; bookName: string; chaptersText: string };
type SectionRow = { heading: string; body: string };

function ProposalForm({ initial, submitLabel, pending, onSubmit, onCancel }: {
  initial?: PbeMaterialDraftPayload;
  submitLabel: string;
  pending: boolean;
  onSubmit: (payload: PbeMaterialDraftPayload) => void;
  onCancel?: () => void;
}) {
  const [yearLabel, setYearLabel] = useState(initial?.yearLabel ?? "");
  const [resourcesPage, setResourcesPage] = useState(initial?.sourceUrls.resourcesPage ?? "");
  const [versesPdf, setVersesPdf] = useState(initial?.sourceUrls.versesPdf ?? "");
  const [commentaryPdf, setCommentaryPdf] = useState(initial?.sourceUrls.commentaryPdf ?? "");
  const [rows, setRows] = useState<RosterRow[]>(initial?.books.map(book => ({ bookKey: book.bookKey, bookName: book.bookName, chaptersText: formatChapters(book.chapters) })) ?? [{ bookKey: "", bookName: "", chaptersText: "" }]);
  const [commentaryBookName, setCommentaryBookName] = useState(initial?.commentary.bookName ?? "");
  const [commentaryTitle, setCommentaryTitle] = useState(initial?.commentary.title ?? "");
  const [sections, setSections] = useState<SectionRow[]>(initial?.commentary.sections.map(section => ({ heading: section.heading, body: section.body })) ?? [{ heading: "", body: "" }]);
  const [formError, setFormError] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (!/^\d{4}-\d{2}$/.test(yearLabel.trim())) { setFormError("Year label must look like 2025-26."); return; }
    if (!resourcesPage.trim()) { setFormError("The NAD PBE resources page URL is required."); return; }
    const books: PbeMaterialDraftPayload["books"] = [];
    for (const [index, row] of rows.entries()) {
      if (!row.bookKey.trim() || !row.bookName.trim()) { setFormError(`Roster row ${index + 1} needs a book key and a book name.`); return; }
      const chapters = parseChapterList(row.chaptersText);
      if (!chapters) { setFormError(`Roster row ${index + 1} chapters must look like "1-33" or "1,2,3".`); return; }
      books.push({ bookKey: row.bookKey.trim().toUpperCase(), bookName: row.bookName.trim(), chapters });
    }
    if (!commentaryBookName.trim() || !commentaryTitle.trim()) { setFormError("The commentary needs a book name and a title."); return; }
    const cleaned = sections.map(section => ({ heading: section.heading.trim(), body: section.body.trim() })).filter(section => section.heading || section.body);
    if (cleaned.some(section => !section.heading || !section.body)) { setFormError("Every commentary section needs a heading and a body."); return; }
    if (!cleaned.length) { setFormError("Add at least one commentary section."); return; }
    setFormError("");
    onSubmit({
      yearLabel: yearLabel.trim(),
      books,
      commentary: { bookName: commentaryBookName.trim(), title: commentaryTitle.trim(), sections: cleaned },
      sourceUrls: { resourcesPage: resourcesPage.trim(), ...(versesPdf.trim() ? { versesPdf: versesPdf.trim() } : {}), ...(commentaryPdf.trim() ? { commentaryPdf: commentaryPdf.trim() } : {}) },
    });
  }

  return <form className="materials-form" onSubmit={submit} aria-busy={pending}>
    {formError && <Notice tone="danger">{formError}</Notice>}
    <div className="materials-form-grid">
      <label>Competition year<Input value={yearLabel} placeholder="2025-26" onChange={event => setYearLabel(event.target.value)} disabled={pending} required /></label>
      <label>NAD PBE resources page URL<Input type="url" value={resourcesPage} placeholder="https://nadpbe.org/pbe-resources/" onChange={event => setResourcesPage(event.target.value)} disabled={pending} required /></label>
      <label>Verses PDF URL (optional)<Input type="url" value={versesPdf} onChange={event => setVersesPdf(event.target.value)} disabled={pending} /></label>
      <label>Commentary PDF URL (optional)<Input type="url" value={commentaryPdf} onChange={event => setCommentaryPdf(event.target.value)} disabled={pending} /></label>
    </div>
    <h3>Book roster</h3>
    {rows.map((row, index) => <div className="materials-repeat-row" key={index}>
      <label>Book key<Input value={row.bookKey} placeholder="ISA" onChange={event => { const next = [...rows]; next[index] = { ...row, bookKey: event.target.value }; setRows(next); }} disabled={pending} /></label>
      <label>Book name<Input value={row.bookName} placeholder="Isaiah" onChange={event => { const next = [...rows]; next[index] = { ...row, bookName: event.target.value }; setRows(next); }} disabled={pending} /></label>
      <label>Chapters<Input value={row.chaptersText} placeholder="1-33" onChange={event => { const next = [...rows]; next[index] = { ...row, chaptersText: event.target.value }; setRows(next); }} disabled={pending} /></label>
      <Button type="button" variant="ghost" size="compact" disabled={pending || rows.length <= 1} onClick={() => setRows(rows.filter((_, i) => i !== index))} aria-label={`Remove roster row ${index + 1}`}>Remove</Button>
    </div>)}
    <Button type="button" variant="secondary" size="compact" disabled={pending} onClick={() => setRows([...rows, { bookKey: "", bookName: "", chaptersText: "" }])}>Add book</Button>
    <h3>Commentary introduction</h3>
    <div className="materials-form-grid">
      <label>Commentary book name<Input value={commentaryBookName} placeholder="Isaiah" onChange={event => setCommentaryBookName(event.target.value)} disabled={pending} /></label>
      <label>Commentary title<Input value={commentaryTitle} placeholder="ISAIAH" onChange={event => setCommentaryTitle(event.target.value)} disabled={pending} /></label>
    </div>
    {sections.map((section, index) => <div className="materials-section-row" key={index}>
      <div className="materials-repeat-row">
        <label>Section heading<Input value={section.heading} placeholder="Title and Authorship" onChange={event => { const next = [...sections]; next[index] = { ...section, heading: event.target.value }; setSections(next); }} disabled={pending} /></label>
        <Button type="button" variant="ghost" size="compact" disabled={pending || sections.length <= 1} onClick={() => setSections(sections.filter((_, i) => i !== index))} aria-label={`Remove section ${index + 1}`}>Remove</Button>
      </div>
      <label>Section body<Textarea rows={4} value={section.body} onChange={event => { const next = [...sections]; next[index] = { ...section, body: event.target.value }; setSections(next); }} disabled={pending} /></label>
    </div>)}
    <Button type="button" variant="secondary" size="compact" disabled={pending} onClick={() => setSections([...sections, { heading: "", body: "" }])}>Add section</Button>
    <div className="materials-form-actions">
      {onCancel && <Button type="button" variant="secondary" disabled={pending} onClick={onCancel}>Cancel</Button>}
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : submitLabel}</Button>
    </div>
  </form>;
}

function proposalStatusBadge(status: PbeMaterialProposal["status"]) {
  return <Badge tone={status === "approved" ? "success" : status === "rejected" ? "warning" : "info"}>{status === "approved" ? "Approved" : status === "rejected" ? "Rejected" : "Draft"}</Badge>;
}

export function MaterialsPage({ initialTab }: { initialTab?: "releases" | "news" }) {
  const { me, loading, error: authError } = useAuth();
  const allowed = !loading && !authError && me?.kind === "Adult" && (me.role === "Owner" || me.role === "Content Manager");
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "news" ? "news" : params.get("tab") === "releases" ? "releases" : (initialTab ?? "releases");
  const proposalId = params.get("proposal");
  const setTab = (next: "releases" | "news") => { const n = new URLSearchParams(params); n.set("tab", next); n.delete("proposal"); setParams(n); };

  if (loading) return <LoadingState label="Checking your account…" />;
  if (!allowed) return <div className="training-page"><PageHeader title="PBE materials" /><Notice tone="danger">PBE materials and news management is limited to the club Owner and Content Managers.</Notice><LinkButton to={me?.kind === "Student" ? "/student" : "/login"}>Return to your workspace</LinkButton></div>;

  return <div className="training-page"><PageHeader title={tab === "news" ? "PBE news" : "PBE materials"} help="Review yearly PBE releases and news. Nothing publishes itself — the club Owner approves every release, and publishes or unpublishes every news article." />
    <div role="tablist" aria-label="Materials sections" className="ds-tablist">
      <Button variant={tab === "releases" ? "primary" : "secondary"} size="compact" role="tab" aria-selected={tab === "releases"} onClick={() => setTab("releases")}>Releases</Button>
      <Button variant={tab === "news" ? "primary" : "secondary"} size="compact" role="tab" aria-selected={tab === "news"} onClick={() => setTab("news")}>News</Button>
    </div>
    {tab === "releases"
      ? (proposalId
        ? <ProposalDetail org={me!.organizationId} id={proposalId} isOwner={me!.role === "Owner"} viewerId={me!.userId} onBack={() => { const n = new URLSearchParams(params); n.delete("proposal"); setParams(n); }} />
        : <ReleasesList org={me!.organizationId} onReview={id => { const n = new URLSearchParams(params); n.set("proposal", id); setParams(n); }} />)
      : <NewsManager org={me!.organizationId} isOwner={me!.role === "Owner"} />}
  </div>;
}

function ReleasesList({ org, onReview }: { org: string; onReview: (id: string) => void }) {
  const client = useQueryClient();
  const releases = useQuery({ queryKey: ["pbe-releases", org], queryFn: () => api.pbeReleases(org), retry: false });
  const [showNewForm, setShowNewForm] = useState(false);
  const [watching, setWatching] = useState(false);
  const [watchResult, setWatchResult] = useState<PbeMaterialWatchResult | null>(null);
  const [watchError, setWatchError] = useState("");
  const [createPending, setCreatePending] = useState(false);
  const [createError, setCreateError] = useState("");

  async function checkWatcher() {
    if (watching) return;
    setWatching(true); setWatchError(""); setWatchResult(null);
    try {
      const result = await api.watchNadMaterials(org);
      setWatchResult(result);
      await Promise.all([client.invalidateQueries({ queryKey: ["pbe-releases", org] }), client.invalidateQueries({ queryKey: ["pbe-news-articles", org] })]);
    } catch (failure) { setWatchError(failure instanceof Error ? failure.message : "The NAD check failed. Try again."); }
    finally { setWatching(false); }
  }

  async function create(payload: PbeMaterialDraftPayload) {
    setCreatePending(true); setCreateError("");
    try {
      const proposal = await api.createPbeRelease(org, { yearLabel: payload.yearLabel, material: payload });
      setShowNewForm(false);
      await client.invalidateQueries({ queryKey: ["pbe-releases", org] });
      onReview(proposal.id);
    } catch (failure) { setCreateError(failure instanceof Error ? failure.message : "The proposal could not be saved. Try again."); }
    finally { setCreatePending(false); }
  }

  return <>
    <div className="materials-actions">
      <Button onClick={() => void checkWatcher()} disabled={watching}>{watching ? "Checking nadpbe.org…" : "Check for new NAD materials"}</Button>
      <Button variant="secondary" onClick={() => setShowNewForm(!showNewForm)}>{showNewForm ? "Close proposal form" : "New proposal"}</Button>
    </div>
    {watchError && <Notice tone="danger">{watchError}</Notice>}
    {watchResult && <Notice tone="success">
      <p>Checked nadpbe.org at {formatDateTime(watchResult.checkedAt)} — {watchResult.mediaChecked} media items checked, {watchResult.drafted.length} new draft{watchResult.drafted.length === 1 ? "" : "s"}.</p>
      {watchResult.drafted.length > 0 && <ul className="materials-watch-list">{watchResult.drafted.map(draft => <li key={draft.proposalId}>
        <LinkButton variant="secondary" size="compact" to={`/admin/materials?tab=releases&proposal=${encodeURIComponent(draft.proposalId)}`}>Review {formatPbeYearLabel(draft.yearLabel)}</LinkButton>
        <span>{draft.title}</span>
      </li>)}</ul>}
      <p className="materials-hint">Watcher news suggestions appear under the News tab.</p>
    </Notice>}
    {showNewForm && <Panel><h2>New proposal<HelpTip label="About new proposals">Draft a yearly release. It stays a draft until the club Owner approves it.</HelpTip></h2>
      {createError && <Notice tone="danger">{createError}</Notice>}
      <ProposalForm submitLabel="Save draft proposal" pending={createPending} onSubmit={create} onCancel={() => setShowNewForm(false)} />
    </Panel>}
    <Panel><h2>Proposals</h2>
      {releases.isPending ? <LoadingState label="Loading proposals…" /> : releases.isError ? <Notice tone="danger">Proposals could not load. <Button variant="secondary" size="compact" onClick={() => void releases.refetch()}>Try again</Button></Notice>
        : releases.data.length === 0 ? <EmptyState title="No proposals yet" description="Check for new NAD materials above, or create the first proposal manually." />
        : <ul className="materials-list">{releases.data.map(proposal => <li key={proposal.id} className="materials-list-row">
          <div className="materials-list-detail">
            <strong>{formatPbeYearLabel(proposal.yearLabel)}</strong>
            <div className="materials-badges">{proposalStatusBadge(proposal.status)}<Badge>{proposal.origin === "watcher" ? "Watcher" : "Manual"}</Badge></div>
            <small>Proposed {formatDateTime(proposal.proposedAtUtc)}{proposal.decidedAtUtc ? ` · decided ${formatDateTime(proposal.decidedAtUtc)}` : ""}</small>
          </div>
          <Button variant="secondary" size="compact" onClick={() => onReview(proposal.id)}>Review</Button>
        </li>)}</ul>}
    </Panel>
  </>;
}

function DiffSummary({ diff, yearLabel }: { diff: PbeMaterialDiff; yearLabel: string }) {
  const changes = diff.booksChanged || diff.rosterChanged || diff.addedSections.length > 0 || diff.removedSections.length > 0 || diff.changedSections.length > 0;
  return <Panel><h2>Changes compared with the live release</h2>
    {!changes && <p>No differences from the current live release for {formatPbeYearLabel(yearLabel)}.</p>}
    {(diff.booksChanged || diff.rosterChanged) && <Notice>The book roster or book details differ from the live release.</Notice>}
    {diff.addedSections.length > 0 && <div className="materials-diff-group"><h3>New sections</h3><ul>{diff.addedSections.map(heading => <li key={heading}><Badge tone="success">Added</Badge> {heading}</li>)}</ul></div>}
    {diff.changedSections.length > 0 && <div className="materials-diff-group"><h3>Changed sections</h3><ul>{diff.changedSections.map(heading => <li key={heading}><Badge tone="info">Changed</Badge> {heading}</li>)}</ul></div>}
    {diff.removedSections.length > 0 && <div className="materials-diff-group"><h3>Removed sections</h3><ul>{diff.removedSections.map(heading => <li key={heading}><Badge tone="warning">Removed</Badge> {heading}</li>)}</ul></div>}
  </Panel>;
}

function ProposalDetail({ org, id, isOwner, viewerId, onBack }: { org: string; id: string; isOwner: boolean; viewerId: string; onBack: () => void }) {
  const client = useQueryClient();
  const detail = useQuery({ queryKey: ["pbe-release", org, id], queryFn: () => api.pbeRelease(org, id), retry: false });
  const [reviewNote, setReviewNote] = useState("");
  const [reviewPending, setReviewPending] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [justApproved, setJustApproved] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editPending, setEditPending] = useState(false);
  const [editError, setEditError] = useState("");

  async function review(decision: "approved" | "rejected") {
    if (reviewPending) return;
    setReviewPending(true); setReviewError(""); setJustApproved(false);
    try {
      await api.reviewPbeRelease(org, id, { decision, note: reviewNote.trim() || undefined });
      setReviewNote("");
      if (decision === "approved") setJustApproved(true);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["pbe-release", org, id] }),
        client.invalidateQueries({ queryKey: ["pbe-releases", org] }),
        client.invalidateQueries({ queryKey: ["pbe-materials"] }),
      ]);
    } catch (failure) { setReviewError(failure instanceof Error ? failure.message : "The review could not be saved. Try again."); }
    finally { setReviewPending(false); }
  }

  async function saveEdit(payload: PbeMaterialDraftPayload) {
    setEditPending(true); setEditError("");
    try {
      await api.updatePbeRelease(org, id, { yearLabel: payload.yearLabel, material: payload });
      setEditing(false);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["pbe-release", org, id] }),
        client.invalidateQueries({ queryKey: ["pbe-releases", org] }),
      ]);
    } catch (failure) { setEditError(failure instanceof Error ? failure.message : "The draft could not be saved. Try again."); }
    finally { setEditPending(false); }
  }

  if (detail.isPending) return <><Button variant="secondary" size="compact" onClick={onBack}>← All proposals</Button><LoadingState label="Loading the proposal…" /></>;
  if (detail.isError) return <><Button variant="secondary" size="compact" onClick={onBack}>← All proposals</Button><Notice tone="danger">The proposal could not load. <Button variant="secondary" size="compact" onClick={() => void detail.refetch()}>Try again</Button></Notice></>;
  const { proposal, diff } = detail.data;
  const isDraft = proposal.status === "draft";
  const isProposer = proposal.proposedBy === viewerId;

  return <>
    <div className="materials-actions"><Button variant="secondary" size="compact" onClick={onBack}>← All proposals</Button></div>
    {justApproved && <Notice tone="success"><p><strong>Approved.</strong> The {formatPbeYearLabel(proposal.yearLabel)} materials are now live for students.</p><p><LinkButton variant="secondary" size="compact" to="/student/study?mode=Library">See what students will see</LinkButton></p></Notice>}
    <Panel><div className="materials-detail-heading"><h2>{formatPbeYearLabel(proposal.yearLabel)} proposal</h2><div className="materials-badges">{proposalStatusBadge(proposal.status)}<Badge>{proposal.origin === "watcher" ? "Watcher" : "Manual"}</Badge></div></div>
      <dl className="materials-meta">
        <div><dt>Proposed</dt><dd>{formatDateTime(proposal.proposedAtUtc)} by {proposal.proposedBy === "nad-watcher" ? "NAD watcher" : "a coach"}</dd></div>
        {proposal.decidedAtUtc && <div><dt>Decided</dt><dd>{formatDateTime(proposal.decidedAtUtc)}</dd></div>}
        {proposal.reviewNote && <div><dt>Review note</dt><dd>{proposal.reviewNote}</dd></div>}
      </dl>
      <h3>Sources</h3>
      <SourceLinks urls={proposal.material.sourceUrls} labels={{ verses: "View original verses", commentary: "View original commentary" }} />
    </Panel>
    <DiffSummary diff={diff} yearLabel={proposal.yearLabel} />
    <Panel><h2>Book roster</h2>
      <div className="training-table-scroll" role="region" aria-label="Proposed book roster" tabIndex={0}><table className="training-table"><thead><tr><th>Key</th><th>Book</th><th>Chapters</th></tr></thead>
        <tbody>{proposal.material.books.map(book => <tr key={book.bookKey}><td>{book.bookKey}</td><td>{book.bookName}</td><td>{formatChapters(book.chapters)}</td></tr>)}</tbody></table></div>
    </Panel>
    <Panel><h2>Commentary introduction</h2>
      <p className="materials-commentary-title"><strong>{proposal.material.commentary.title}</strong> <span>· {proposal.material.commentary.bookName}</span></p>
      {proposal.material.commentary.sections.map((section, index) => <section key={index} className="materials-section"><h3>{section.heading}</h3><p className="materials-section-body">{section.body}</p></section>)}
    </Panel>
    {isDraft && (editing
      ? <Panel><h2>Edit draft</h2>{editError && <Notice tone="danger">{editError}</Notice>}
        <ProposalForm initial={proposal.material} submitLabel="Save draft changes" pending={editPending} onSubmit={saveEdit} onCancel={() => setEditing(false)} /></Panel>
      : <div className="materials-actions"><Button variant="secondary" onClick={() => setEditing(true)}>Edit draft</Button></div>)}
    <Panel><h2>Review</h2>
      {reviewError && <Notice tone="danger">{reviewError}</Notice>}
      {!isOwner && <Notice id="materials-review-owner-notice">Approval requires the club Owner (master admin) role. Owners and Content Managers can prepare drafts, but only the Owner can approve or reject a release.</Notice>}
      {isProposer && <Notice id="materials-review-separation-notice">You proposed this release, so a different approver must review it — the proposer cannot approve their own proposal.</Notice>}
      <label>Review note (optional)<Textarea rows={3} value={reviewNote} onChange={event => setReviewNote(event.target.value)} disabled={reviewPending || !isDraft} placeholder="What changed, what to double-check…" /></label>
      <div className="materials-form-actions">
        <Button variant="secondary" disabled={!isOwner || isProposer || !isDraft || reviewPending} aria-describedby={!isOwner ? "materials-review-owner-notice" : isProposer ? "materials-review-separation-notice" : undefined} onClick={() => void review("rejected")}>{reviewPending ? "Saving…" : "Reject"}</Button>
        <Button disabled={!isOwner || isProposer || !isDraft || reviewPending} aria-describedby={!isOwner ? "materials-review-owner-notice" : isProposer ? "materials-review-separation-notice" : undefined} onClick={() => void review("approved")}>{reviewPending ? "Saving…" : "Approve and publish"}</Button>
      </div>
      {!isDraft && <p className="materials-hint">This proposal has already been decided; the review controls are closed.</p>}
    </Panel>
  </>;
}

type LinkedMaterialRow = { label: string; href: string; hint: string };

function NewsArticleForm({ initial, submitLabel, reviewLabel, pending, onSubmit, onCancel }: {
  initial?: PbeNewsArticleInput;
  submitLabel: string;
  reviewLabel?: string;
  pending: boolean;
  onSubmit: (input: PbeNewsArticleInput, forReview: boolean) => void;
  onCancel: () => void;
}) {
  const [articleType, setArticleType] = useState<PbeNewsArticleType>(initial?.articleType ?? "announcement");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [keyPoints, setKeyPoints] = useState<string[]>(initial?.keyPoints ?? []);
  const [newKeyPoint, setNewKeyPoint] = useState("");
  const [materials, setMaterials] = useState<LinkedMaterialRow[]>(initial?.linkedMaterials?.map(material => ({ label: material.label, href: material.href, hint: material.hint ?? "" })) ?? []);
  const [readMinutes, setReadMinutes] = useState(initial?.readMinutes != null ? String(initial.readMinutes) : "");
  const [sourceUrl, setSourceUrl] = useState(initial?.sourceUrl ?? "");
  const [sourceLabel, setSourceLabel] = useState(initial?.sourceLabel ?? "");
  const [sections, setSections] = useState<SectionRow[]>(initial?.sections.map(section => ({ heading: section.heading, body: section.body })) ?? [{ heading: "", body: "" }]);
  const [formError, setFormError] = useState("");

  function addKeyPoint() {
    const point = newKeyPoint.trim();
    if (!point || keyPoints.length >= 6) return;
    setKeyPoints([...keyPoints, point]);
    setNewKeyPoint("");
  }

  function buildInput(): PbeNewsArticleInput | null {
    if (!title.trim() || !summary.trim()) { setFormError("The article needs a title and a summary."); return null; }
    const cleaned = sections.map(section => ({ heading: section.heading.trim(), body: section.body.trim() })).filter(section => section.heading || section.body);
    if (cleaned.some(section => !section.heading || !section.body)) { setFormError("Every section needs a heading and a body."); return null; }
    if (!cleaned.length) { setFormError("Add at least one section."); return null; }
    const points = keyPoints.map(point => point.trim()).filter(Boolean);
    const linked = materials
      .map(material => ({ label: material.label.trim(), href: material.href.trim(), hint: material.hint.trim() }))
      .filter(material => material.label || material.href);
    if (linked.some(material => !material.label || !material.href)) { setFormError("Each linked material needs a label and a link."); return null; }
    const trimmed = readMinutes.trim();
    const minutes = trimmed === "" ? null : Number(trimmed);
    if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1)) { setFormError("Read time must be a whole number of minutes."); return null; }
    setFormError("");
    return {
      title: title.trim(),
      summary: summary.trim(),
      articleType,
      sections: cleaned,
      ...(points.length ? { keyPoints: points } : {}),
      ...(linked.length ? { linkedMaterials: linked.map(({ label, href, hint }) => hint ? { label, href, hint } : { label, href }) } : {}),
      ...(minutes !== null ? { readMinutes: minutes } : {}),
      ...(sourceUrl.trim() ? { sourceUrl: sourceUrl.trim() } : {}),
      ...(sourceLabel.trim() ? { sourceLabel: sourceLabel.trim() } : {}),
    };
  }

  function submit(event: FormEvent, forReview: boolean) {
    event.preventDefault();
    if (pending) return;
    const input = buildInput();
    if (input) onSubmit(input, forReview);
  }

  return <form className="materials-form" onSubmit={event => submit(event, false)} aria-busy={pending}>
    {formError && <Notice tone="danger">{formError}</Notice>}
    <label>Article type<Select value={articleType} onChange={event => setArticleType(event.target.value as PbeNewsArticleType)} disabled={pending}>
      {PBE_NEWS_TYPES.map(entry => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
    </Select></label>
    <span className="materials-hint">Sets the card art and kicker students see at a glance.</span>
    <div className="newsroom-art-preview" aria-hidden="true"><ArticleTypeArt type={articleType} /></div>
    <label>Title<Input value={title} onChange={event => setTitle(event.target.value)} disabled={pending} required /></label>
    <label>Summary (1–2 sentences for the feed card)<Textarea rows={2} value={summary} onChange={event => setSummary(event.target.value)} disabled={pending} required /></label>
    <span className="materials-hint">This is all most students will read. Say what they will find inside the article.</span>
    <div className="materials-form-block">
      <span className="materials-label">Key points <small>Shown on the student card as chips — up to 6.</small></span>
      {keyPoints.length > 0 && <ul className="materials-keypoint-list">{keyPoints.map((point, index) => <li key={index}>
        <span>{point}</span>
        <Button type="button" variant="ghost" size="compact" disabled={pending} onClick={() => setKeyPoints(keyPoints.filter((_, i) => i !== index))} aria-label={`Remove key point ${index + 1}`}>Remove</Button>
      </li>)}</ul>}
      <div className="materials-keypoint-add">
        <Input value={newKeyPoint} onChange={event => setNewKeyPoint(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addKeyPoint(); } }} placeholder="Add a key point" aria-label="New key point" maxLength={140} disabled={pending} />
        <Button type="button" variant="secondary" size="compact" disabled={pending || !newKeyPoint.trim() || keyPoints.length >= 6} onClick={addKeyPoint}>Add point</Button>
      </div>
    </div>
    <div className="materials-form-block">
      <span className="materials-label">Linked reading material <small>Deep links — students open them straight from the card and the article.</small></span>
      {materials.map((material, index) => <div className="materials-section-row" key={index}>
        <div className="materials-repeat-row">
          <label>Label<Input value={material.label} placeholder="Isaiah 53 commentary notes" onChange={event => { const next = [...materials]; next[index] = { ...material, label: event.target.value }; setMaterials(next); }} disabled={pending} /></label>
          <label>Link<Input value={material.href} placeholder="https://… or /student/…" onChange={event => { const next = [...materials]; next[index] = { ...material, href: event.target.value }; setMaterials(next); }} disabled={pending} /></label>
          <label>Hint (optional)<Input value={material.hint} placeholder="Library › 2025–26 › Isaiah 53" onChange={event => { const next = [...materials]; next[index] = { ...material, hint: event.target.value }; setMaterials(next); }} disabled={pending} /></label>
          <Button type="button" variant="ghost" size="compact" disabled={pending} onClick={() => setMaterials(materials.filter((_, i) => i !== index))} aria-label={`Remove linked material ${index + 1}`}>Remove</Button>
        </div>
      </div>)}
      <Button type="button" variant="secondary" size="compact" disabled={pending} onClick={() => setMaterials([...materials, { label: "", href: "", hint: "" }])}>Add linked material</Button>
    </div>
    <label>Read time (minutes, optional)<Input type="number" min={1} value={readMinutes} onChange={event => setReadMinutes(event.target.value)} disabled={pending} /></label>
    {sections.map((section, index) => <div className="materials-section-row" key={index}>
      <div className="materials-repeat-row">
        <label>Section heading<Input value={section.heading} onChange={event => { const next = [...sections]; next[index] = { ...section, heading: event.target.value }; setSections(next); }} disabled={pending} /></label>
        <Button type="button" variant="ghost" size="compact" disabled={pending || sections.length <= 1} onClick={() => setSections(sections.filter((_, i) => i !== index))} aria-label={`Remove section ${index + 1}`}>Remove</Button>
      </div>
      <label>Section body<Textarea rows={4} value={section.body} onChange={event => { const next = [...sections]; next[index] = { ...section, body: event.target.value }; setSections(next); }} disabled={pending} /></label>
    </div>)}
    <Button type="button" variant="secondary" size="compact" disabled={pending} onClick={() => setSections([...sections, { heading: "", body: "" }])}>Add section</Button>
    <div className="materials-form-grid">
      <label>Source URL (optional)<Input type="url" value={sourceUrl} placeholder="https://nadpbe.org/…" onChange={event => setSourceUrl(event.target.value)} disabled={pending} /></label>
      <label>Source label (optional)<Input value={sourceLabel} placeholder="nadpbe.org" onChange={event => setSourceLabel(event.target.value)} disabled={pending} /></label>
    </div>
    <div className="materials-form-actions">
      <Button type="button" variant="secondary" disabled={pending} onClick={onCancel}>Cancel</Button>
      {reviewLabel && <Button type="button" variant="secondary" disabled={pending} onClick={event => submit(event, true)}>{pending ? "Saving…" : reviewLabel}</Button>}
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : submitLabel}</Button>
    </div>
  </form>;
}

function NewsManager({ org, isOwner }: { org: string; isOwner: boolean }) {
  const client = useQueryClient();
  const articles = useQuery({ queryKey: ["pbe-news-articles", org], queryFn: () => api.pbeNewsArticles(org), retry: false });
  const [editor, setEditor] = useState<{ mode: "new" | "edit"; articleId?: string; initial?: PbeNewsArticleInput } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [reviewNotice, setReviewNotice] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [watching, setWatching] = useState(false);
  const [watchError, setWatchError] = useState("");
  const [watchResult, setWatchResult] = useState<PbeMaterialWatchResult | null>(null);

  async function mutate(id: string | null, run: () => Promise<unknown>, after?: () => void) {
    if (busyId) return;
    setBusyId(id ?? "new"); setError("");
    try {
      await run();
      after?.();
      await Promise.all([
        client.invalidateQueries({ queryKey: ["pbe-news-articles", org] }),
        client.invalidateQueries({ queryKey: ["pbe-news", org] }),
      ]);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The news change could not be saved. Try again."); }
    finally { setBusyId(null); }
  }

  function toInput(article: PbeNewsArticle): PbeNewsArticleInput {
    return {
      title: article.title,
      summary: article.summary,
      articleType: normalizeArticleType(article.articleType),
      sections: article.sections,
      ...(article.keyPoints?.length ? { keyPoints: article.keyPoints } : {}),
      ...(article.linkedMaterials?.length ? { linkedMaterials: article.linkedMaterials } : {}),
      ...(article.readMinutes != null ? { readMinutes: article.readMinutes } : {}),
      ...(article.sourceUrl ? { sourceUrl: article.sourceUrl } : {}),
      ...(article.sourceLabel ? { sourceLabel: article.sourceLabel } : {}),
    };
  }

  const saveNew = (input: PbeNewsArticleInput, forReview: boolean) => mutate(null, () => api.createPbeNewsArticle(org, input), () => {
    setEditor(null);
    setReviewNotice(forReview ? "Draft saved and sent to the club Owner for review. It stays a draft until the Owner publishes it." : "");
  });
  const saveEdit = (articleId: string, input: PbeNewsArticleInput) => mutate(articleId, () => api.updatePbeNewsArticle(org, articleId, input), () => setEditor(null));

  async function deleteArticle(id: string) {
    await mutate(id, () => api.deletePbeNewsArticle(org, id), () => setConfirmDeleteId(null));
  }

  async function checkNewsWatcher() {
    setWatching(true); setWatchError(""); setWatchResult(null);
    try {
      const result = await api.watchNadMaterials(org);
      setWatchResult(result);
      await client.invalidateQueries({ queryKey: ["pbe-news-articles", org] });
    } catch (failure) { setWatchError(failure instanceof Error ? failure.message : "The NAD check failed. Try again."); }
    finally { setWatching(false); }
  }

  async function importFromUrl(event: FormEvent) {
    event.preventDefault();
    const url = importUrl.trim();
    if (!url) { setImportError("Paste a source URL to import."); return; }
    setImporting(true); setImportError(""); setReviewNotice("");
    try {
      const draft = await api.extractPbeNewsDraft(org, url);
      setImportUrl("");
      setEditor({
        mode: "new",
        initial: {
          title: draft.title,
          summary: draft.summary,
          articleType: "announcement",
          sections: draft.sections,
          ...(draft.keyPoints.length ? { keyPoints: draft.keyPoints } : {}),
          sourceUrl: draft.sourceUrl,
          sourceLabel: draft.sourceLabel,
        },
      });
    } catch (failure) { setImportError(failure instanceof Error ? failure.message : "The article could not be extracted. Check the URL and try again."); }
    finally { setImporting(false); }
  }

  function pipelineRow(article: PbeNewsArticle) {
    return <li key={article.id} className="newsroom-row">
      <div className="materials-list-detail">
        <span className="newsroom-kicker">{articleTypeLabel(article.articleType)}</span>
        <strong>{article.title}</strong>
        <div className="materials-badges">
          <Badge tone={article.status === "published" ? "success" : "neutral"}>{article.status === "published" ? "Published" : "Draft"}</Badge>
          <Badge>{article.createdBy === "nad-watcher" ? "Watcher" : "Manual"}</Badge>
        </div>
        <p className="materials-news-summary">{article.summary}</p>
        <small>Created {formatDateTime(article.createdAtUtc)}{article.publishedAtUtc ? ` · published ${formatDateTime(article.publishedAtUtc)}` : ""}</small>
        <details className="materials-news-preview"><summary>Preview article</summary>
          {article.sections.map((section, index) => <section key={index}><h4>{section.heading}</h4><p className="materials-section-body">{section.body}</p></section>)}
          {article.sourceUrl && <p><a href={article.sourceUrl} target="_blank" rel="noreferrer">{article.sourceLabel ?? "View original announcement"}</a></p>}
        </details>
      </div>
      <div className="materials-row-actions">
        <Button variant="secondary" size="compact" disabled={!!busyId} onClick={() => setEditor({ mode: "edit", articleId: article.id, initial: toInput(article) })}>Edit</Button>
        {article.status === "published"
          ? <Button variant="secondary" size="compact" disabled={!isOwner || !!busyId} aria-describedby={!isOwner ? "materials-news-owner-notice" : undefined} onClick={() => void mutate(article.id, () => api.unpublishPbeNewsArticle(org, article.id))}>{busyId === article.id ? "Saving…" : "Unpublish"}</Button>
          : <Button size="compact" disabled={!isOwner || !!busyId} aria-describedby={!isOwner ? "materials-news-owner-notice" : undefined} onClick={() => void mutate(article.id, () => api.publishPbeNewsArticle(org, article.id))}>{busyId === article.id ? "Saving…" : "Publish"}</Button>}
        {isOwner && <Button variant="danger" size="compact" disabled={!!busyId} onClick={() => setConfirmDeleteId(article.id)}>Delete</Button>}
      </div>
    </li>;
  }

  const drafts = (articles.data ?? []).filter(article => article.status === "draft");
  const published = (articles.data ?? []).filter(article => article.status === "published");

  return <>
    {!isOwner && <Notice id="materials-news-owner-notice">Publishing and unpublishing news articles requires the club Owner (master admin) role. Owners and Content Managers can draft and edit articles; publishing a watcher-suggested draft is the Owner's review step.</Notice>}
    {error && <Notice tone="danger">{error}</Notice>}
    {reviewNotice && <Notice tone="success">{reviewNotice}</Notice>}
    <div className="newsroom">
      <section className="newsroom-col" aria-label="Sources">
        <h2>Sources</h2>
        <p className="materials-hint">Pull the latest PBE developments. The weekly NAD watcher drafts suggestions automatically; import any announcement link into a draft you can edit.</p>
        <Button onClick={() => void checkNewsWatcher()} disabled={watching}>{watching ? "Checking nadpbe.org…" : "Check for new NAD materials"}</Button>
        {watchError && <Notice tone="danger">{watchError}</Notice>}
        {watchResult && <Notice tone="success">
          <p>Checked nadpbe.org at {formatDateTime(watchResult.checkedAt)} — {watchResult.mediaChecked} media items checked, {watchResult.drafted.length} new draft{watchResult.drafted.length === 1 ? "" : "s"}.</p>
          <p className="materials-hint">Watcher news suggestions appear in the Pipeline column.</p>
        </Notice>}
        <form className="newsroom-import" onSubmit={importFromUrl}>
          <h3>Import from URL</h3>
          <div className="newsroom-import-row">
            <Input type="url" value={importUrl} onChange={event => setImportUrl(event.target.value)} placeholder="https://nadpbe.org/…" aria-label="Source URL to import" disabled={importing} />
            <Button type="submit" disabled={importing || !importUrl.trim()}>{importing ? "Extracting…" : "Extract"}</Button>
          </div>
          {importError && <Notice tone="danger">{importError}</Notice>}
        </form>
      </section>
      <section className="newsroom-col newsroom-editor-col" aria-label="Article editor">
        <h2>Article editor</h2>
        {editor ? (editor.mode === "new"
          ? <NewsArticleForm initial={editor.initial} submitLabel="Save draft article" reviewLabel="Send for review" pending={busyId === "new"} onSubmit={saveNew} onCancel={() => setEditor(null)} />
          : <NewsArticleForm initial={editor.initial} submitLabel="Save changes" pending={busyId === editor.articleId} onSubmit={input => saveEdit(editor.articleId!, input)} onCancel={() => setEditor(null)} />)
          : <div className="newsroom-editor-idle">
            <p className="materials-hint">Pick Edit on a pipeline article, import a source URL, or start a fresh draft. Articles stay drafts until the club Owner publishes them.</p>
            <Button variant="secondary" onClick={() => setEditor({ mode: "new" })}>New article</Button>
          </div>}
      </section>
      <section className="newsroom-col" aria-label="Pipeline">
        <h2>Pipeline</h2>
        {articles.isPending ? <LoadingState label="Loading articles…" /> : articles.isError ? <Notice tone="danger">Articles could not load. <Button variant="secondary" size="compact" onClick={() => void articles.refetch()}>Try again</Button></Notice>
          : articles.data!.length === 0 ? <EmptyState title="No news articles yet" description="Import a source URL, run “Check for new NAD materials”, or start the first draft." />
          : <>
            <h3 className="newsroom-group-heading">Drafts{!isOwner && <span className="newsroom-group-sub"> — awaiting Owner review</span>}</h3>
            {drafts.length === 0 ? <p className="materials-hint">No drafts right now.</p> : <ul className="newsroom-list">{drafts.map(pipelineRow)}</ul>}
            <h3 className="newsroom-group-heading">Published</h3>
            {published.length === 0 ? <p className="materials-hint">Nothing published yet.</p> : <ul className="newsroom-list">{published.map(pipelineRow)}</ul>}
          </>}
      </section>
    </div>
    {confirmDeleteId && (() => {
      const target = (articles.data ?? []).find(article => article.id === confirmDeleteId);
      return <ConfirmationDialog
        title="Delete this news article?"
        description={`"${target?.title ?? "This article"}" will be permanently deleted. Published copies disappear from the student feed immediately. This cannot be undone.`}
        confirmLabel="Delete article"
        pendingLabel="Deleting…"
        variant="danger"
        pending={busyId === confirmDeleteId}
        error={error}
        onCancel={() => { setConfirmDeleteId(null); setError(""); }}
        onConfirm={() => void deleteArticle(confirmDeleteId)}
      />;
    })()}
  </>;
}

