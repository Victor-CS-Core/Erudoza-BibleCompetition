import type { Actor, Env, RequestContext } from '../types';
import { body, HttpError, json, requiredString } from '../types';
import { LIBRARY_ORG } from './library-access';
import { Store } from '../store';
import { atomic, fail, id, requireLearner } from './model';
import type { Season } from './model';

/** PBE study-material releases + news, stored as global built-in records under LIBRARY_ORG. */

export interface PbeCommentarySection { heading: string; body: string; }

export interface PbeMaterialSourceUrls {
  versesPdf?: string;        // NAD "Bible Verses" PDF URL
  commentaryPdf?: string;    // NAD "Commentary" PDF URL
  resourcesPage: string;     // https://nadpbe.org/pbe-resources/
}

/** kind='pbe-material' — one record per competition year. Only live, approved releases exist. */
export interface PbeMaterial {
  id: string;                // `pbe-material-2025-26` (stable, derived from yearLabel)
  yearLabel: string;         // e.g. "2025-26"
  books: { bookKey: string; bookName: string; chapters: number[] }[];  // year roster; bookKey matches NKJV packs (e.g. "ISA")
  commentary: { bookName: string; title: string; sections: PbeCommentarySection[] };
  sourceUrls: PbeMaterialSourceUrls;
  approvedBy: string;        // user id of the master admin (Owner) who approved
  approvedAtUtc: string;     // ISO
  releaseNote?: string;
  version: number;           // increments if the same year is re-released
}

/** kind='pbe-material-proposal' — the review pipeline. */
export interface PbeMaterialProposal {
  id: string;                // uuid
  yearLabel: string;
  status: 'draft' | 'approved' | 'rejected';
  origin: 'watcher' | 'manual';
  proposedBy: string;        // user id, or 'nad-watcher'
  proposedAtUtc: string;
  material: {                // draft payload (no id/status/version)
    yearLabel: string;
    books: { bookKey: string; bookName: string; chapters: number[] }[];
    commentary: { bookName: string; title: string; sections: PbeCommentarySection[] };
    sourceUrls: PbeMaterialSourceUrls;
  };
  reviewNote?: string;
  decidedBy?: string;
  decidedAtUtc?: string;
}

export interface PbeMaterialDraft {
  yearLabel: string;
  books: { bookKey: string; bookName: string; chapters: number[] }[];
  commentary: { bookName: string; title: string; sections: PbeCommentarySection[] };
  sourceUrls: PbeMaterialSourceUrls;
}

/** Diff of a proposal's draft payload vs the current live material for the same year. */
export interface PbeMaterialDiff {
  booksChanged: boolean;     // any book/chapter difference at all
  rosterChanged: boolean;     // the set of books changed (a book was added or removed)
  addedSections: string[];    // section headings only in the proposal
  removedSections: string[];  // section headings only in the live material
  changedSections: string[];  // headings present in both with different bodies
}

export interface PbeNewsSection { heading: string; body: string; }

/** kind='pbe-news-article' — under LIBRARY_ORG (global, shared). */
export interface PbeNewsArticle {
  id: string;                    // uuid
  title: string;
  summary: string;               // 1-2 sentence teaser for the feed card
  sections: PbeNewsSection[];     // article body
  sourceUrl?: string;            // optional deep link to the original announcement
  sourceLabel?: string;          // e.g. "nadpbe.org"
  status: 'draft' | 'published';
  createdBy: string;             // user id or 'nad-watcher'
  createdAtUtc: string;
  updatedAtUtc: string;
  publishedAtUtc?: string;
  publishedBy?: string;         // Owner user id who published
}

const NAD_ORIGIN = 'https://nadpbe.org';
const RESOURCES_PAGE = 'https://nadpbe.org/pbe-resources/';

interface StoredLib<T> { value: T; revision: number }
async function getLib<T>(ctx: RequestContext, kind: string, recId: string): Promise<StoredLib<T> | null> {
  const row = await ctx.env.DB.prepare("SELECT data,revision FROM Records WHERE kind=? AND id=? AND org_id=?").bind(kind, recId, LIBRARY_ORG).first<{ data: string; revision: number }>();
  return row ? { value: JSON.parse(row.data) as T, revision: row.revision } : null;
}
async function listLib<T>(ctx: RequestContext, kind: string): Promise<T[]> {
  const rows = await ctx.env.DB.prepare("SELECT data FROM Records WHERE kind=? AND org_id=? ORDER BY id").bind(kind, LIBRARY_ORG).all<{ data: string }>();
  return rows.results.map(r => JSON.parse(r.data) as T);
}
function insertLib(ctx: RequestContext, kind: string, recId: string, value: unknown) {
  return ctx.env.DB.prepare("INSERT INTO Records(kind,id,org_id,data,revision) VALUES(?,?,?,?,1)").bind(kind, recId, LIBRARY_ORG, JSON.stringify(value));
}

function ownerOnly(actor: Actor, action: string): void {
  if (actor.role !== 'Owner') throw new HttpError(403, `Only the Owner (master admin) can ${action}.`);
}

/**
 * Draft-level PBE content access: Owner and Content Manager only. Regular Admins
 * have no access to PBE materials/news management at all (403, not hidden links).
 * Approval/rejection of releases and publishing/unpublishing news stay ownerOnly.
 */
function contentAccess(actor: Actor): void {
  if (actor.kind !== 'Adult' || !['Owner', 'Content Manager'].includes(actor.role))
    throw new HttpError(403, 'PBE content access denied.');
}

function httpUrl(value: unknown, name: string, required: boolean): string | undefined {
  if (value === undefined || value === null || value === '') {
    if (required) return fail(`${name} is required.`);
    return undefined;
  }
  if (typeof value !== 'string') return fail(`${name} must be a URL.`);
  const trimmed = value.trim();
  let parsed: URL;
  try { parsed = new URL(trimmed); } catch { return fail(`${name} must be a valid URL.`); }
  if (!['http:', 'https:'].includes(parsed.protocol)) return fail(`${name} must be an http(s) URL.`);
  return parsed.toString();
}

function validateYearLabel(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value.trim())) return fail('Choose a year label like 2025-26.');
  return value.trim();
}

function validateSections(value: unknown, strict: boolean, singular: string): PbeCommentarySection[] {
  if (!Array.isArray(value) || value.length === 0) {
    if (strict) return fail(`Add at least one ${singular} section.`);
    return [];
  }
  return value.map(section => {
    if (!section || typeof section !== 'object') return fail(`Choose a valid ${singular} section.`);
    const s = section as { heading?: unknown; body?: unknown };
    return { heading: requiredString(s.heading, 'Section heading', 500), body: requiredString(s.body, 'Section body', 60000) };
  });
}

function validateBooks(value: unknown, strict: boolean): PbeMaterialDraft['books'] {
  if (!Array.isArray(value) || value.length === 0) {
    if (strict) return fail('Add at least one book to the roster.');
    return [];
  }
  return value.map(entry => {
    if (!entry || typeof entry !== 'object') return fail('Choose a valid book roster.');
    const b = entry as { bookKey?: unknown; bookName?: unknown; chapters?: unknown };
    const bookKey = requiredString(b.bookKey, 'Book key', 20).toUpperCase();
    const bookName = requiredString(b.bookName, 'Book name', 200);
    if (!Array.isArray(b.chapters) || b.chapters.length === 0) return fail(`Choose chapters for ${bookName}.`);
    const chapters = [...new Set(b.chapters.map(chapter => {
      if (typeof chapter !== 'number' || !Number.isSafeInteger(chapter) || chapter < 1 || chapter > 200) return fail(`Choose valid chapter numbers for ${bookName}.`);
      return chapter;
    }))].sort((a, b2) => a - b2);
    return { bookKey, bookName, chapters };
  });
}

function validateSourceUrls(value: unknown): PbeMaterialSourceUrls {
  if (!value || typeof value !== 'object') return fail('Choose the source URLs.');
  const v = value as { versesPdf?: unknown; commentaryPdf?: unknown; resourcesPage?: unknown };
  const resourcesPage = httpUrl(v.resourcesPage, 'Resources page', true)!;
  const versesPdf = httpUrl(v.versesPdf, 'Verses PDF', false);
  const commentaryPdf = httpUrl(v.commentaryPdf, 'Commentary PDF', false);
  return { ...(versesPdf ? { versesPdf } : {}), ...(commentaryPdf ? { commentaryPdf } : {}), resourcesPage };
}

function validateDraftPayload(input: { yearLabel?: unknown; material?: unknown }, strict: boolean): PbeMaterialDraft {
  const yearLabel = validateYearLabel(input.yearLabel);
  const raw = input.material;
  if (!raw || typeof raw !== 'object') return fail('Add the material payload.');
  const m = raw as { yearLabel?: unknown; books?: unknown; commentary?: unknown; sourceUrls?: unknown };
  if (m.yearLabel !== undefined && m.yearLabel !== yearLabel) return fail('The payload year label must match the release year label.');
  const commentary = m.commentary;
  if (!commentary || typeof commentary !== 'object') return fail('Add the commentary introduction.');
  const c = commentary as { bookName?: unknown; title?: unknown; sections?: unknown };
  return {
    yearLabel,
    books: validateBooks(m.books, strict),
    commentary: { bookName: requiredString(c.bookName, 'Commentary book name', 200), title: requiredString(c.title, 'Commentary title', 500), sections: validateSections(c.sections, strict, 'commentary') },
    sourceUrls: validateSourceUrls(m.sourceUrls),
  };
}

function materialId(yearLabel: string): string { return `pbe-material-${yearLabel}`; }
function gateId(yearLabel: string): string { return `pbe-${yearLabel}`; }

/** Live materials are global, but only count when their per-year readiness gate is written. */
async function liveMaterialByYear(ctx: RequestContext): Promise<Map<string, PbeMaterial>> {
  const rows = await ctx.env.DB.prepare("SELECT id,data FROM Records WHERE kind='pbe-material' AND org_id=?").bind(LIBRARY_ORG).all<{ id: string; data: string }>();
  const gates = await ctx.env.DB.prepare("SELECT id,data FROM Records WHERE kind='library-version' AND org_id=? AND id LIKE 'pbe-%'").bind(LIBRARY_ORG).all<{ id: string; data: string }>();
  const ready = new Set(gates.results.filter(g => {
    try { return (JSON.parse(g.data) as { ready?: boolean }).ready === true; } catch { return false; }
  }).map(g => g.id.slice(4)));
  const map = new Map<string, PbeMaterial>();
  for (const r of rows.results) {
    const material = JSON.parse(r.data) as PbeMaterial;
    if (material.yearLabel && ready.has(material.yearLabel)) map.set(material.yearLabel, material);
  }
  return map;
}

function materialSummary(m: PbeMaterial) {
  return {
    yearLabel: m.yearLabel, books: m.books,
    commentary: { bookName: m.commentary.bookName, title: m.commentary.title, sectionHeadings: m.commentary.sections.map(s => s.heading) },
    sourceUrls: m.sourceUrls, approvedAtUtc: m.approvedAtUtc,
  };
}

function proposalSummary(p: PbeMaterialProposal) {
  return {
    id: p.id, yearLabel: p.yearLabel, status: p.status, origin: p.origin,
    proposedBy: p.proposedBy, proposedAtUtc: p.proposedAtUtc,
    decidedBy: p.decidedBy ?? null, decidedAtUtc: p.decidedAtUtc ?? null,
    bookCount: p.material.books.length, sectionCount: p.material.commentary.sections.length,
  };
}

function diffMaterial(draft: PbeMaterialDraft, live: PbeMaterial | null): PbeMaterialDiff {
  if (!live) return {
    booksChanged: draft.books.length > 0, rosterChanged: draft.books.length > 0,
    addedSections: draft.commentary.sections.map(s => s.heading), removedSections: [], changedSections: [],
  };
  const liveKeys = live.books.map(b => b.bookKey), draftKeys = draft.books.map(b => b.bookKey);
  const rosterChanged = liveKeys.length !== draftKeys.length || liveKeys.some(k => !draftKeys.includes(k));
  const liveChapters = new Map(live.books.map(b => [b.bookKey, b.chapters.join(',')]));
  const booksChanged = rosterChanged || draft.books.some(b => liveChapters.get(b.bookKey) !== b.chapters.join(','));
  const liveSections = new Map(live.commentary.sections.map(s => [s.heading, s.body]));
  const draftSections = new Map(draft.commentary.sections.map(s => [s.heading, s.body]));
  return {
    booksChanged, rosterChanged,
    addedSections: draft.commentary.sections.filter(s => !liveSections.has(s.heading)).map(s => s.heading),
    removedSections: live.commentary.sections.filter(s => !draftSections.has(s.heading)).map(s => s.heading),
    changedSections: draft.commentary.sections.filter(s => liveSections.has(s.heading) && liveSections.get(s.heading) !== s.body).map(s => s.heading),
  };
}

async function currentMaterial(ctx: RequestContext): Promise<{ material: PbeMaterial | null }> {
  const seasonId = new URL(ctx.request.url).searchParams.get('seasonId');
  if (!seasonId) return fail('seasonId is required.');
  const season = await ctx.env.DB.prepare("SELECT data FROM Records WHERE kind='season' AND org_id=? AND id=?").bind(ctx.orgId, seasonId).first<{ data: string }>();
  if (!season) throw new HttpError(404, 'Season was not found.');
  const yearLabel = (JSON.parse(season.data) as Season).yearLabel;
  if (!yearLabel) return { material: null };
  const live = await liveMaterialByYear(ctx);
  return { material: live.get(yearLabel) ?? null };
}

async function createProposal(ctx: RequestContext): Promise<PbeMaterialProposal> {
  const input = await body<{ yearLabel?: unknown; material?: unknown }>(ctx.request);
  const draft = validateDraftPayload(input, true);
  const now = new Date().toISOString();
  const proposal: PbeMaterialProposal = {
    id: id(), yearLabel: draft.yearLabel, status: 'draft', origin: 'manual',
    proposedBy: ctx.actor.userId, proposedAtUtc: now, material: draft,
  };
  await insertLib(ctx, 'pbe-material-proposal', proposal.id, proposal).run();
  return proposal;
}

async function updateProposal(ctx: RequestContext, proposalId: string): Promise<PbeMaterialProposal> {
  const stored = await getLib<PbeMaterialProposal>(ctx, 'pbe-material-proposal', proposalId);
  if (!stored || stored.value.status !== 'draft') throw new HttpError(404, 'Only draft proposals can be updated.');
  const input = await body<{ yearLabel?: unknown; material?: unknown }>(ctx.request);
  const draft = validateDraftPayload(input, false);
  const updated: PbeMaterialProposal = { ...stored.value, yearLabel: draft.yearLabel, material: draft };
  const result = await ctx.env.DB.prepare("UPDATE Records SET data=?,revision=revision+1 WHERE kind='pbe-material-proposal' AND id=? AND org_id=? AND revision=? AND json_extract(data,'$.status')='draft'")
    .bind(JSON.stringify(updated), proposalId, LIBRARY_ORG, stored.revision).run();
  if (result.meta.changes !== 1) throw new HttpError(409, 'The record changed. Refresh and retry.');
  return updated;
}

async function releaseDetail(ctx: RequestContext, proposalId: string): Promise<{ proposal: PbeMaterialProposal; diff: PbeMaterialDiff; live: PbeMaterial | null }> {
  const stored = await getLib<PbeMaterialProposal>(ctx, 'pbe-material-proposal', proposalId);
  if (!stored) throw new HttpError(404, 'Proposal was not found.');
  const live = (await liveMaterialByYear(ctx)).get(stored.value.yearLabel) ?? null;
  return { proposal: stored.value, diff: diffMaterial(stored.value.material, live), live };
}

async function reviewProposal(ctx: RequestContext, proposalId: string): Promise<PbeMaterialProposal> {
  ownerOnly(ctx.actor, 'review material releases');
  const stored = await getLib<PbeMaterialProposal>(ctx, 'pbe-material-proposal', proposalId);
  if (!stored) throw new HttpError(404, 'Proposal was not found.');
  const proposal = stored.value;
  if (proposal.status !== 'draft') throw new HttpError(400, 'Only draft proposals can be reviewed.');
  if (proposal.proposedBy === ctx.actor.userId)
    throw new HttpError(403, 'The proposer cannot review their own proposal; review requires a different approver.');
  const input = await body<{ decision?: unknown; note?: unknown }>(ctx.request);
  if (input.decision !== 'approved' && input.decision !== 'rejected') return fail("Choose 'approved' or 'rejected'.");
  const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim().slice(0, 2000) : undefined;
  const now = new Date().toISOString();
  if (input.decision === 'rejected') {
    const decided: PbeMaterialProposal = { ...proposal, status: 'rejected', reviewNote: note ?? proposal.reviewNote, decidedBy: ctx.actor.userId, decidedAtUtc: now };
    const result = await ctx.env.DB.prepare("UPDATE Records SET data=?,revision=revision+1 WHERE kind='pbe-material-proposal' AND id=? AND org_id=? AND revision=? AND json_extract(data,'$.status')='draft'")
      .bind(JSON.stringify(decided), proposal.id, LIBRARY_ORG, stored.revision).run();
    if (result.meta.changes !== 1) throw new HttpError(409, 'The record changed. Refresh and retry.');
    return decided;
  }
  // Approve: re-validate, then upsert the live material + readiness gate + mark the proposal, all in one transaction.
  const draft = validateDraftPayload({ yearLabel: proposal.yearLabel, material: proposal.material }, true);
  const mid = materialId(draft.yearLabel), gid = gateId(draft.yearLabel);
  const existing = await getLib<PbeMaterial>(ctx, 'pbe-material', mid);
  const gate = await getLib<{ ready: boolean }>(ctx, 'library-version', gid);
  const live: PbeMaterial = {
    id: mid, yearLabel: draft.yearLabel, books: draft.books, commentary: draft.commentary, sourceUrls: draft.sourceUrls,
    approvedBy: ctx.actor.userId, approvedAtUtc: now, ...(note ? { releaseNote: note } : {}), version: existing ? existing.value.version + 1 : 1,
  };
  const decided: PbeMaterialProposal = { ...proposal, status: 'approved', reviewNote: note ?? proposal.reviewNote, decidedBy: ctx.actor.userId, decidedAtUtc: now, material: draft };
  const liveJson = JSON.stringify(live), gateJson = JSON.stringify({ ready: true }), decidedJson = JSON.stringify(decided);
  const materialStmt = existing
    ? ctx.env.DB.prepare("UPDATE Records SET data=?,revision=revision+1 WHERE kind='pbe-material' AND id=? AND org_id=? AND revision=?").bind(liveJson, mid, LIBRARY_ORG, existing.revision)
    : ctx.env.DB.prepare("INSERT INTO Records(kind,id,org_id,data,revision) VALUES('pbe-material',?,?,?,1)").bind(mid, LIBRARY_ORG, liveJson);
  const gateStmt = gate
    ? ctx.env.DB.prepare("UPDATE Records SET data=?,revision=revision+1 WHERE kind='library-version' AND id=? AND org_id=? AND revision=?").bind(gateJson, gid, LIBRARY_ORG, gate.revision)
    : ctx.env.DB.prepare("INSERT INTO Records(kind,id,org_id,data,revision) VALUES('library-version',?,?,?,1)").bind(gid, LIBRARY_ORG, gateJson);
  const proposalStmt = ctx.env.DB.prepare("UPDATE Records SET data=?,revision=revision+1 WHERE kind='pbe-material-proposal' AND id=? AND org_id=? AND revision=? AND json_extract(data,'$.status')='draft'")
    .bind(decidedJson, proposal.id, LIBRARY_ORG, stored.revision);
  const auditId = id(), auditJson = JSON.stringify({ id: auditId, actorId: ctx.actor.userId, action: 'pbe-materials.release.approve', createdAtUtc: now });
  // Read the material back inside the transaction: the gate and the approval only persist when the
  // written rows verify, so a failed write rolls everything back instead of half-publishing.
  const verify = ctx.env.DB.prepare(`INSERT INTO Records(kind,id,org_id,data) VALUES('audit',?,?,CASE WHEN
      EXISTS(SELECT 1 FROM Records WHERE kind='pbe-material' AND id=? AND org_id=? AND data=? AND revision=?)
      AND EXISTS(SELECT 1 FROM Records WHERE kind='library-version' AND id=? AND org_id=? AND data=?)
      AND EXISTS(SELECT 1 FROM Records WHERE kind='pbe-material-proposal' AND id=? AND org_id=? AND data=? AND revision=?)
      THEN ? ELSE 'invalid-json' END)`)
    .bind(auditId, ctx.orgId, mid, LIBRARY_ORG, liveJson, (existing?.revision ?? 0) + 1, gid, LIBRARY_ORG, gateJson, proposal.id, LIBRARY_ORG, decidedJson, stored.revision + 1, auditJson);
  await atomic(ctx, 'pbe-materials.release.approve', [materialStmt, gateStmt, proposalStmt, verify]);
  return decided;
}

/* ---------------- NAD watcher ---------------- */

interface WpMediaItem {
  id: number; date?: string; modified?: string; slug?: string; mime_type?: string; source_url?: string;
  title?: { rendered?: string }; caption?: { rendered?: string };
}
interface WpSearchItem { id: number; title?: string; url?: string; type?: string; subtype?: string }

function stripTags(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0*39;|&apos;/g, "'").replace(/\s+/g, ' ').trim();
}

function guessYearLabel(item: WpMediaItem): { yearLabel: string; guessNote?: string } {
  const haystack = `${stripTags(item.title?.rendered)} ${stripTags(item.caption?.rendered)} ${item.slug ?? ''}`;
  const found = haystack.match(/\b(20\d{2})\b/);
  if (found) {
    const y = Number(found[1]);
    return { yearLabel: `${y}-${String(y + 1).slice(2)}`, guessNote: `The watcher guessed the competition year from "${found[1]}" in the media title or caption — confirm before approving.` };
  }
  const date = item.date || item.modified ? new Date((item.date || item.modified) as string) : null;
  if (date && !Number.isNaN(date.getTime())) {
    const start = date.getUTCMonth() + 1 >= 8 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
    return { yearLabel: `${start}-${String(start + 1).slice(2)}`, guessNote: `The watcher guessed the competition year from the upload date ${(item.date || item.modified)!.slice(0, 10)} — confirm before approving.` };
  }
  return { yearLabel: '20YY-YY', guessNote: 'The watcher could not determine the competition year — the master admin must set the year label before approving.' };
}

async function fetchNadJson(url: string): Promise<unknown[]> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (error) {
    throw new HttpError(502, `The NAD watcher could not reach nadpbe.org (${url}): ${error instanceof Error ? error.message : 'network error'}.`);
  }
  if (!res.ok) throw new HttpError(502, `The NAD watcher request failed with status ${res.status} (${url}).`);
  try {
    const parsed: unknown = await res.json();
    if (!Array.isArray(parsed)) throw new Error('expected an array');
    return parsed;
  } catch {
    throw new HttpError(502, `The NAD watcher received an unreadable response (${url}).`);
  }
}

export interface WatcherResult {
  checkedAt: string;
  mediaChecked: number;
  drafted: { proposalId: string; yearLabel: string; title: string; sourceUrl: string }[];
  newsDrafted: { articleId: string; title: string; sourceUrl: string }[];
}

/** kind='pbe-watcher-run' — audit trail of watcher checks (scheduled + manual). */
export interface PbeWatcherRun {
  id: string;
  checkedAt: string;
  trigger: 'scheduled' | 'manual';
  mediaChecked: number;
  drafted: number;
  newsDrafted: number;
}

async function recordWatchRun(ctx: RequestContext, result: WatcherResult, trigger: PbeWatcherRun['trigger']): Promise<void> {
  const runId = id();
  const run: PbeWatcherRun = {
    id: runId, checkedAt: result.checkedAt, trigger,
    mediaChecked: result.mediaChecked, drafted: result.drafted.length, newsDrafted: result.newsDrafted.length,
  };
  await insertLib(ctx, 'pbe-watcher-run', runId, run).run();
}

async function runWatchCore(ctx: RequestContext): Promise<WatcherResult> {
  const checkedAt = new Date().toISOString();
  const drafted: WatcherResult['drafted'] = [], newsDrafted: WatcherResult['newsDrafted'] = [];
  let mediaChecked = 0;
  const materialSources = new Set<string>();
  for (const p of await listLib<PbeMaterialProposal>(ctx, 'pbe-material-proposal'))
    for (const u of [p.material.sourceUrls.versesPdf, p.material.sourceUrls.commentaryPdf, p.material.sourceUrls.resourcesPage]) if (u) materialSources.add(u);
  for (const m of await listLib<PbeMaterial>(ctx, 'pbe-material'))
    for (const u of [m.sourceUrls.versesPdf, m.sourceUrls.commentaryPdf, m.sourceUrls.resourcesPage]) if (u) materialSources.add(u);
  const articleSources = new Set<string>();
  for (const a of await listLib<PbeNewsArticle>(ctx, 'pbe-news-article')) if (a.sourceUrl) articleSources.add(a.sourceUrl);

  const draftNews = async (article: PbeNewsArticle): Promise<void> => {
    await insertLib(ctx, 'pbe-news-article', article.id, article).run();
    articleSources.add(article.sourceUrl ?? '');
    newsDrafted.push({ articleId: article.id, title: article.title, sourceUrl: article.sourceUrl ?? '' });
  };

  for (const query of ['commentary', 'verses', 'pbe']) {
    const items = await fetchNadJson(`${NAD_ORIGIN}/wp-json/wp/v2/media?per_page=100&search=${query}`) as WpMediaItem[];
    for (const item of items) {
      if (item.mime_type !== 'application/pdf' || !item.source_url || !item.source_url.startsWith(`${NAD_ORIGIN}/wp-content/uploads/`)) continue;
      mediaChecked++;
      if (materialSources.has(item.source_url)) continue;
      materialSources.add(item.source_url);
      const title = stripTags(item.title?.rendered) || item.slug || 'NAD PBE material';
      const { yearLabel, guessNote } = guessYearLabel(item);
      const isCommentary = /commentar/i.test(`${item.slug ?? ''} ${title}`);
      const proposalId = id();
      const proposal: PbeMaterialProposal = {
        id: proposalId, yearLabel, status: 'draft', origin: 'watcher', proposedBy: 'nad-watcher', proposedAtUtc: checkedAt,
        material: { yearLabel, books: [], commentary: { bookName: '', title, sections: [] }, sourceUrls: { resourcesPage: RESOURCES_PAGE, ...(isCommentary ? { commentaryPdf: item.source_url } : { versesPdf: item.source_url }) } },
        ...(guessNote ? { reviewNote: guessNote } : {}),
      };
      await insertLib(ctx, 'pbe-material-proposal', proposalId, proposal).run();
      drafted.push({ proposalId, yearLabel, title, sourceUrl: item.source_url });
      await draftNews({
        id: id(), title: `New PBE materials detected: ${title}`,
        summary: `NAD posted a new ${isCommentary ? 'Commentary' : 'Bible verses'} PDF for the ${yearLabel} competition year.`,
        sections: [{ heading: 'Detected by the NAD watcher', body: `The NAD watcher found "${title}" on nadpbe.org (${item.source_url}). A matching release proposal was drafted for master-admin review; the roster and commentary still need to be completed before approval.` }],
        sourceUrl: item.source_url, sourceLabel: 'nadpbe.org',
        status: 'draft', createdBy: 'nad-watcher', createdAtUtc: checkedAt, updatedAtUtc: checkedAt,
      });
    }
  }

  const searchItems = await fetchNadJson(`${NAD_ORIGIN}/wp-json/wp/v2/search?search=PBE&per_page=20`) as WpSearchItem[];
  for (const item of searchItems) {
    if (!item.url) continue;
    if (articleSources.has(item.url)) continue;
    const title = stripTags(item.title) || item.url;
    await draftNews({
      id: id(), title, summary: 'New announcement on nadpbe.org.',
      sections: [{ heading: 'Announcement', body: `"${title}" was posted on nadpbe.org. Open the original announcement for the full details.` }],
      sourceUrl: item.url, sourceLabel: 'nadpbe.org',
      status: 'draft', createdBy: 'nad-watcher', createdAtUtc: checkedAt, updatedAtUtc: checkedAt,
    });
  }

  return { checkedAt, mediaChecked, drafted, newsDrafted };
}

async function watchNad(ctx: RequestContext): Promise<WatcherResult> {
  contentAccess(ctx.actor);
  const result = await runWatchCore(ctx);
  await recordWatchRun(ctx, result, 'manual');
  return result;
}

/**
 * Entry point for the Cloudflare cron trigger (see the `triggers.crons` in the
 * wrangler configs). Runs the NAD watch as the first-party system identity —
 * no HTTP request and no session auth involved. Drafts only; the master admin
 * still reviews everything in /admin/materials.
 */
export async function runScheduledWatch(env: Env): Promise<WatcherResult> {
  const ctx: RequestContext = {
    request: new Request('https://internal/scheduled/pbe-watch'),
    env,
    actor: {
      userId: 'nad-watcher', organizationId: LIBRARY_ORG, organizationName: 'Erudoza Built-in Scripture Library',
      displayName: 'NAD watcher', userName: 'nad-watcher', email: null,
      kind: 'Adult', role: 'Owner', credentialVersion: '0',
    },
    path: '/pbe-materials/watch',
    orgId: LIBRARY_ORG,
    store: new Store(env.DB),
  };
  const result = await runWatchCore(ctx);
  await recordWatchRun(ctx, result, 'scheduled');
  return result;
}

/* ---------------- news ---------------- */

function articleSummary(a: PbeNewsArticle) {
  return {
    id: a.id, title: a.title, summary: a.summary, status: a.status,
    sections: a.sections,
    publishedAtUtc: a.publishedAtUtc ?? null, publishedBy: a.publishedBy ?? null,
    sourceUrl: a.sourceUrl ?? null, sourceLabel: a.sourceLabel ?? null,
    createdBy: a.createdBy, createdAtUtc: a.createdAtUtc, updatedAtUtc: a.updatedAtUtc,
  };
}

function validateArticlePayload(input: { title?: unknown; summary?: unknown; sections?: unknown; sourceUrl?: unknown; sourceLabel?: unknown }): {
  title: string; summary: string; sections: PbeNewsSection[]; sourceUrl?: string; sourceLabel?: string;
} {
  const title = requiredString(input.title, 'Title', 500);
  const summary = requiredString(input.summary, 'Summary', 2000);
  const sections = validateSections(input.sections, true, 'article');
  const sourceUrl = httpUrl(input.sourceUrl, 'Source URL', false);
  const sourceLabel = input.sourceLabel === undefined || input.sourceLabel === null || input.sourceLabel === ''
    ? undefined
    : requiredString(input.sourceLabel, 'Source label', 200);
  return { title, summary, sections, ...(sourceUrl ? { sourceUrl } : {}), ...(sourceLabel ? { sourceLabel } : {}) };
}

async function publishedNews(ctx: RequestContext): Promise<PbeNewsArticle[]> {
  return (await listLib<PbeNewsArticle>(ctx, 'pbe-news-article'))
    .filter(a => a.status === 'published')
    .sort((a, b) => (b.publishedAtUtc ?? '').localeCompare(a.publishedAtUtc ?? '') || b.id.localeCompare(a.id));
}

async function allArticles(ctx: RequestContext): Promise<PbeNewsArticle[]> {
  return (await listLib<PbeNewsArticle>(ctx, 'pbe-news-article'))
    .sort((a, b) => b.createdAtUtc.localeCompare(a.createdAtUtc) || b.id.localeCompare(a.id));
}

async function createArticle(ctx: RequestContext): Promise<PbeNewsArticle> {
  const input = await body<{ title?: unknown; summary?: unknown; sections?: unknown; sourceUrl?: unknown; sourceLabel?: unknown }>(ctx.request);
  const now = new Date().toISOString();
  const article: PbeNewsArticle = { id: id(), ...validateArticlePayload(input), status: 'draft', createdBy: ctx.actor.userId, createdAtUtc: now, updatedAtUtc: now };
  await insertLib(ctx, 'pbe-news-article', article.id, article).run();
  return article;
}

async function updateArticle(ctx: RequestContext, articleId: string): Promise<PbeNewsArticle> {
  const stored = await getLib<PbeNewsArticle>(ctx, 'pbe-news-article', articleId);
  if (!stored) throw new HttpError(404, 'Article was not found.');
  const input = await body<{ title?: unknown; summary?: unknown; sections?: unknown; sourceUrl?: unknown; sourceLabel?: unknown }>(ctx.request);
  const updated: PbeNewsArticle = { ...stored.value, ...validateArticlePayload(input), updatedAtUtc: new Date().toISOString() };
  const result = await ctx.env.DB.prepare("UPDATE Records SET data=?,revision=revision+1 WHERE kind='pbe-news-article' AND id=? AND org_id=? AND revision=?")
    .bind(JSON.stringify(updated), articleId, LIBRARY_ORG, stored.revision).run();
  if (result.meta.changes !== 1) throw new HttpError(409, 'The record changed. Refresh and retry.');
  return updated;
}

async function setPublishState(ctx: RequestContext, articleId: string, publish: boolean): Promise<PbeNewsArticle> {
  ownerOnly(ctx.actor, publish ? 'publish news articles' : 'unpublish news articles');
  const stored = await getLib<PbeNewsArticle>(ctx, 'pbe-news-article', articleId);
  if (!stored) throw new HttpError(404, 'Article was not found.');
  const now = new Date().toISOString();
  const updated: PbeNewsArticle = {
    ...stored.value,
    status: publish ? 'published' : 'draft',
    updatedAtUtc: now,
    ...(publish ? { publishedAtUtc: now, publishedBy: ctx.actor.userId } : {}),
  };
  const result = await ctx.env.DB.prepare("UPDATE Records SET data=?,revision=revision+1 WHERE kind='pbe-news-article' AND id=? AND org_id=? AND revision=?")
    .bind(JSON.stringify(updated), articleId, LIBRARY_ORG, stored.revision).run();
  if (result.meta.changes !== 1) throw new HttpError(409, 'The record changed. Refresh and retry.');
  return updated;
}

/* ---------------- router ---------------- */

export async function pbeMaterials(ctx: RequestContext): Promise<Response | null> {
  const { path } = ctx, method = ctx.request.method;
  if (path === '/pbe-materials' && method === 'GET') {
    await requireLearner(ctx);
    const live = await liveMaterialByYear(ctx);
    return json([...live.values()].sort((a, b) => b.yearLabel.localeCompare(a.yearLabel)).map(materialSummary));
  }
  if (path === '/pbe-materials/current' && method === 'GET') {
    await requireLearner(ctx);
    return json(await currentMaterial(ctx));
  }
  if (path === '/pbe-materials/watch' && method === 'POST') return json(await watchNad(ctx));
  if (path === '/pbe-materials/releases' && method === 'GET') {
    contentAccess(ctx.actor);
    return json((await listLib<PbeMaterialProposal>(ctx, 'pbe-material-proposal')).sort((a, b) => b.proposedAtUtc.localeCompare(a.proposedAtUtc) || b.id.localeCompare(a.id)).map(proposalSummary));
  }
  if (path === '/pbe-materials/releases' && method === 'POST') {
    contentAccess(ctx.actor);
    return json(await createProposal(ctx), 201);
  }
  const reviewMatch = path.match(/^\/pbe-materials\/releases\/([^/]+)\/review$/);
  if (reviewMatch && method === 'POST') return json(await reviewProposal(ctx, reviewMatch[1]));
  const releaseMatch = path.match(/^\/pbe-materials\/releases\/([^/]+)$/);
  if (releaseMatch && method === 'GET') {
    contentAccess(ctx.actor);
    return json(await releaseDetail(ctx, releaseMatch[1]));
  }
  if (releaseMatch && method === 'PUT') {
    contentAccess(ctx.actor);
    return json(await updateProposal(ctx, releaseMatch[1]));
  }
  if (path === '/pbe-news' && method === 'GET') {
    await requireLearner(ctx);
    return json((await publishedNews(ctx)).map(a => ({
      id: a.id, title: a.title, summary: a.summary, publishedAtUtc: a.publishedAtUtc,
      sourceUrl: a.sourceUrl ?? null, sourceLabel: a.sourceLabel ?? null,
    })));
  }
  if (path === '/pbe-news/articles' && method === 'GET') {
    contentAccess(ctx.actor);
    return json((await allArticles(ctx)).map(articleSummary));
  }
  if (path === '/pbe-news/articles' && method === 'POST') {
    contentAccess(ctx.actor);
    return json(await createArticle(ctx), 201);
  }
  const publishMatch = path.match(/^\/pbe-news\/articles\/([^/]+)\/(publish|unpublish)$/);
  if (publishMatch && method === 'POST') return json(await setPublishState(ctx, publishMatch[1], publishMatch[2] === 'publish'));
  const articleMatch = path.match(/^\/pbe-news\/articles\/([^/]+)$/);
  if (articleMatch && method === 'PUT') {
    contentAccess(ctx.actor);
    return json(await updateArticle(ctx, articleMatch[1]));
  }
  const newsDetail = path.match(/^\/pbe-news\/([^/]+)$/);
  if (newsDetail && method === 'GET') {
    await requireLearner(ctx);
    const stored = await getLib<PbeNewsArticle>(ctx, 'pbe-news-article', newsDetail[1]);
    if (!stored || stored.value.status !== 'published') throw new HttpError(404, 'Article was not found.');
    return json(stored.value);
  }
  return null;
}
