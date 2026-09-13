import type { RequestContext } from '../types';
import { body, HttpError, json } from '../types';
import { requireLearner } from './model';
import { LIBRARY_ORG } from './library-access';

export type NotebookKind = 'highlight' | 'note' | 'bookmark';
export type HighlightColor = 'Promises' | 'People' | 'Review';
export interface NotebookEntryInput {
  kind: NotebookKind;
  contentPackId: string;
  chapter: number;
  sourceUnitId: string | null;
  startOffset: number | null;
  endOffset: number | null;
  color: HighlightColor | null;
  note: string | null;
}
export interface NotebookEntry extends NotebookEntryInput {
  id: string;
  bookName: string;
  citation: string;
  quote: string;
  updatedAtUtc: string;
}
export interface StudyNotebook { version: number; entries: NotebookEntry[] }
interface StoredNotebook { entries: NotebookEntry[] }
interface NotebookRow { data: string; revision: number }
interface PackAnchor { name: string; bookKey: string; chapters: { number: number; verses: number[] }[] }
interface SourceAnchor { citation: string; chapter: number; canonicalText: string; contentPackId: string }

const KIND = 'scripture-notebook';
const MAX_ENTRIES = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const colors = new Set<HighlightColor>(['Promises', 'People', 'Review']);
const fail = (message: string): never => { throw new HttpError(400, message); };
const conflict = (message = 'The notebook changed. Reload it before retrying.'): never => { throw new HttpError(409, message); };
const integer = (value: unknown, minimum = 0): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) return fail('Notebook version and offsets must be valid integers.');
  return value;
};
const uuid = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || !UUID.test(value) || value.toLowerCase() === NIL_UUID) return fail(`${name} must be a valid UUID.`);
  return value.toLowerCase();
};
function object(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(message);
  return value as Record<string, unknown>;
}
function input(value: unknown): NotebookEntryInput {
  const candidate = object(value, 'A notebook entry is required.');
  const kind = candidate.kind;
  if (kind !== 'note' && kind !== 'highlight' && kind !== 'bookmark') return fail('Choose a valid notebook entry kind.');
  const contentPackId = uuid(candidate.contentPackId, 'Content pack');
  const chapter = integer(candidate.chapter, 1);
  if (chapter > 200) return fail('Choose a valid chapter.');
  if (kind === 'bookmark') {
    if (candidate.sourceUnitId !== null || candidate.startOffset !== null || candidate.endOffset !== null || candidate.color !== null || candidate.note !== null)
      return fail('Bookmarks must identify only a book and chapter.');
    return { kind, contentPackId, chapter, sourceUnitId: null, startOffset: null, endOffset: null, color: null, note: null };
  }
  const sourceUnitId = uuid(candidate.sourceUnitId, 'Source unit');
  const startOffset = integer(candidate.startOffset);
  const endOffset = integer(candidate.endOffset);
  if (endOffset <= startOffset) return fail('Choose a nonempty selection inside one verse.');
  if (kind === 'note') {
    if (candidate.color !== null || typeof candidate.note !== 'string') return fail('Notes require text and cannot have a highlight color.');
    const note = candidate.note.trim();
    if (!note || note.length > 2000) return fail('Notes must contain between 1 and 2,000 characters.');
    return { kind, contentPackId, chapter, sourceUnitId, startOffset, endOffset, color: null, note };
  }
  if (candidate.note !== null || typeof candidate.color !== 'string' || !colors.has(candidate.color as HighlightColor))
    return fail('Highlights require Promises, People, or Review and cannot contain a note.');
  return { kind, contentPackId, chapter, sourceUnitId, startOffset, endOffset, color: candidate.color as HighlightColor, note: null };
}
function parseStored(row: NotebookRow | null): StudyNotebook {
  if (!row) return { version: 0, entries: [] };
  const saved = JSON.parse(row.data) as StoredNotebook;
  if (!saved || !Array.isArray(saved.entries) || saved.entries.length > MAX_ENTRIES) throw new Error('Invalid stored notebook.');
  return { version: row.revision, entries: saved.entries };
}
async function load(ctx: RequestContext): Promise<StudyNotebook> {
  const row = await ctx.env.DB.prepare('SELECT data,revision FROM Records WHERE kind=? AND id=? AND org_id=? AND owner_id=?')
    .bind(KIND, ctx.actor.userId, ctx.orgId, ctx.actor.userId).first<NotebookRow>();
  return parseStored(row);
}
async function anchor(ctx: RequestContext, entry: NotebookEntryInput): Promise<Pick<NotebookEntry, 'bookName' | 'citation' | 'quote'>> {
  const packRow = await ctx.env.DB.prepare(`SELECT json_extract(data,'$.bookName') AS name,json_extract(data,'$.bookKey') AS bookKey,json_extract(data,'$.chapters') AS chapters
    FROM Records WHERE kind='pack' AND id=? AND org_id=? AND json_extract(data,'$.isBuiltIn')=1 AND json_extract(data,'$.isActive')=1
    AND json_extract(data,'$.sourceType')='Scripture'`).bind(entry.contentPackId, LIBRARY_ORG).first<{ name: string; bookKey: string; chapters: string }>();
  if (!packRow?.name || !packRow.bookKey) return fail('Choose an active book from the built-in Scripture library.');
  const pack: PackAnchor = { name: packRow.name, bookKey: packRow.bookKey, chapters: JSON.parse(packRow.chapters) as PackAnchor['chapters'] };
  if (!Array.isArray(pack.chapters) || !pack.chapters.some(chapter => chapter.number === entry.chapter)) return fail('Choose a valid chapter in this book.');
  if (entry.kind === 'bookmark') {
    const active = await ctx.env.DB.prepare("SELECT 1 FROM Records WHERE kind='source' AND org_id=? AND owner_id=? AND json_extract(data,'$.chapter')=? AND json_extract(data,'$.isActive')=1 AND coalesce(json_extract(data,'$.isRetired'),0)=0 LIMIT 1")
      .bind(LIBRARY_ORG, entry.contentPackId, entry.chapter).first();
    if (!active) return fail('Choose a valid chapter in this book.');
    return { bookName: pack.name, citation: `${pack.name} ${entry.chapter}`, quote: '' };
  }
  const sourceRow = await ctx.env.DB.prepare(`SELECT json_extract(data,'$.citation') AS citation,json_extract(data,'$.chapter') AS chapter,
    json_extract(data,'$.canonicalText') AS canonicalText,json_extract(data,'$.contentPackId') AS contentPackId
    FROM Records WHERE kind='source' AND id=? AND org_id=? AND owner_id=? AND json_extract(data,'$.isActive')=1
    AND coalesce(json_extract(data,'$.isRetired'),0)=0`).bind(entry.sourceUnitId, LIBRARY_ORG, entry.contentPackId).first<SourceAnchor>();
  if (!sourceRow || sourceRow.contentPackId !== entry.contentPackId || sourceRow.chapter !== entry.chapter)
    return fail('The selection does not match this built-in book and chapter.');
  const quote = sourceRow.canonicalText.slice(entry.startOffset!, entry.endOffset!);
  if (entry.endOffset! > sourceRow.canonicalText.length || !quote.trim()) return fail('Choose a nonempty selection inside one verse.');
  return { bookName: pack.name, citation: sourceRow.citation, quote };
}
async function save(ctx: RequestContext, expected: number, entries: NotebookEntry[]): Promise<StudyNotebook> {
  const result = await ctx.env.DB.prepare(`INSERT INTO Records(kind,id,org_id,season_id,owner_id,data,revision)
    SELECT ?,?,?,NULL,?,?,1 WHERE ?=0 OR EXISTS(SELECT 1 FROM Records WHERE kind=? AND id=? AND org_id=? AND owner_id=? AND revision=?)
    ON CONFLICT(kind,id,org_id) DO UPDATE SET data=excluded.data,revision=Records.revision+1
    WHERE Records.owner_id=excluded.owner_id AND Records.revision=?`)
    .bind(KIND, ctx.actor.userId, ctx.orgId, ctx.actor.userId, JSON.stringify({ entries }), expected,
      KIND, ctx.actor.userId, ctx.orgId, ctx.actor.userId, expected, expected).run();
  if (result.meta.changes !== 1) return conflict();
  return { version: expected + 1, entries };
}

export async function notebook(ctx: RequestContext): Promise<Response | null> {
  const entryMatch = ctx.path.match(/^\/library\/notebook\/entries\/([^/]+)$/);
  if (ctx.path !== '/library/notebook' && !entryMatch) return null;
  await requireLearner(ctx);
  if (ctx.path === '/library/notebook' && ctx.request.method === 'GET') return json(await load(ctx));
  if (!entryMatch) return null;
  const entryId = uuid(entryMatch[1], 'Notebook entry ID');
  const current = await load(ctx);
  if (ctx.request.method === 'PUT') {
    const wrapper = object(await body(ctx.request, 16 * 1024), 'A notebook write is required.');
    const version = integer(wrapper.version);
    if (version !== current.version) return conflict();
    const value = input(wrapper.entry);
    const citation = await anchor(ctx, value);
    const saved: NotebookEntry = { id: entryId, ...value, ...citation, updatedAtUtc: new Date().toISOString() };
    const duplicate = (entry: NotebookEntry) => entry.id === entryId
      || value.kind === 'bookmark' && entry.kind === 'bookmark' && entry.contentPackId === value.contentPackId && entry.chapter === value.chapter
      || value.kind === 'highlight' && entry.kind === 'highlight' && entry.sourceUnitId === value.sourceUnitId
        && entry.startOffset === value.startOffset && entry.endOffset === value.endOffset;
    const remaining = current.entries.filter(entry => !duplicate(entry));
    if (remaining.length >= MAX_ENTRIES) return conflict('Your notebook already has 200 entries. Edit or delete an entry before adding another.');
    const priorIndex = current.entries.findIndex(entry => entry.id === entryId);
    const entries = priorIndex < 0 ? [...remaining, saved] : [...remaining.slice(0, priorIndex), saved, ...remaining.slice(priorIndex)];
    return json(await save(ctx, version, entries));
  }
  if (ctx.request.method === 'DELETE') {
    const rawVersion = new URL(ctx.request.url).searchParams.get('version');
    const version = rawVersion !== null && /^\d+$/.test(rawVersion) ? Number(rawVersion) : Number.NaN;
    integer(version);
    if (version !== current.version) return conflict();
    const entries = current.entries.filter(entry => entry.id !== entryId);
    if (entries.length === current.entries.length) throw new HttpError(404, 'Notebook entry not found.');
    return json(await save(ctx, version, entries));
  }
  return null;
}
