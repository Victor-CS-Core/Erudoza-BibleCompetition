import { useRef, useEffect } from 'react';
import type { NotebookEntry, NotebookEntryInput, NotebookKind } from '../../api/types';
import { Button, Panel, Textarea } from '../ui';

export type NoteDraft = { id: string; entry: NotebookEntryInput; citation: string; quote: string };
export function StudyNotebook({ entries, filter, onFilter, sourceFilter, onClearSource, onNavigate, onEdit, onDelete, ready, loading, draft, onDraft, onSave, onCancel, pending }: {
  entries: NotebookEntry[]; filter: NotebookKind | 'all'; onFilter: (filter: NotebookKind | 'all') => void;
  sourceFilter: string | null; onClearSource: () => void; onNavigate: (entry: NotebookEntry) => void; onEdit: (entry: NotebookEntry) => void;
  onDelete: (entry: NotebookEntry) => void; ready: boolean; loading: boolean;
  draft: NoteDraft | null; onDraft: (note: string) => void; onSave: () => void; onCancel: () => void; pending: boolean;
}) {
  const editor = useRef<HTMLTextAreaElement>(null), panel = useRef<HTMLElement>(null);
  useEffect(() => { if (draft?.id) editor.current?.focus(); }, [draft?.id]);
  useEffect(() => { if (sourceFilter) panel.current?.scrollIntoView?.({ block: 'nearest' }); }, [sourceFilter]);
  const visible = entries.filter(e => (filter === 'all' || filter === e.kind) && (!sourceFilter || e.sourceUnitId === sourceFilter)).sort((a, b) => b.updatedAtUtc.localeCompare(a.updatedAtUtc) || b.id.localeCompare(a.id));
  return <aside className="study-notebook" aria-label="My study notebook" ref={panel}>
    <Panel><h2>My study notebook</h2><p className="ds-study-caption">Private to you · {entries.length}/200 entries</p>
      <div className="study-notebook-filters" aria-label="Notebook filters">{(['all', 'highlight', 'note', 'bookmark'] as const).map(kind => <Button variant={filter === kind ? 'primary' : 'ghost'} size="compact" key={kind} aria-pressed={filter === kind} onClick={() => onFilter(kind)}>{({ all: 'All', highlight: 'Highlights', note: 'Notes', bookmark: 'Bookmarks' })[kind]}</Button>)}</div>
      {sourceFilter && <Button variant="ghost" size="compact" onClick={onClearSource}>Show all passages</Button>}
      {draft && <form className="study-note-editor" onSubmit={e => { e.preventDefault(); onSave(); }}><h3>{entries.some(e => e.id === draft.id) ? 'Edit note' : 'New note'}</h3><p className="ds-study-caption">{draft.citation}</p><blockquote className="ds-study-quote">{draft.quote}</blockquote><label htmlFor="study-note-input">Your note</label><Textarea id="study-note-input" ref={editor} maxLength={2000} required value={draft.entry.note ?? ''} disabled={pending} onChange={e => onDraft(e.target.value)} /><small>{draft.entry.note?.length ?? 0}/2000</small><div className="study-tools-row"><Button type="submit" disabled={!ready || !draft.entry.note?.trim()}>{pending ? 'Saving…' : 'Save note'}</Button><Button variant="secondary" disabled={pending} onClick={onCancel}>Cancel</Button></div></form>}
      {!loading && !entries.length && <p>Your notebook is empty.</p>}
      {!loading && !!entries.length && !visible.length && <p>No {filter === 'all' ? 'entries' : `${filter}s`} in this view.</p>}
      <div className="study-notebook-entries">{visible.map(entry => <article className="ds-study-entry" key={entry.id}><div className="study-entry-heading"><span className="ds-study-caption">{entry.color && <span className={`ds-highlight-swatch ds-highlight-${entry.color.toLowerCase()}`} aria-hidden="true" />} {entry.color ?? (entry.kind === 'note' ? 'Personal note' : 'Bookmark')}</span><Button variant="ghost" size="compact" disabled={!ready || draft?.id === entry.id} aria-label={`Delete ${entry.kind} for ${entry.citation}`} onClick={() => onDelete(entry)}>Remove</Button></div><Button variant="ghost" size="compact" aria-label={`Open ${entry.citation}`} onClick={() => onNavigate(entry)}>{entry.citation}</Button>{entry.quote && <blockquote className="ds-study-quote">{entry.quote}</blockquote>}{entry.note && <p className="study-note-text">{entry.note}</p>}{entry.kind === 'bookmark' && <p className="ds-study-caption">Saved for later reading.</p>}{entry.kind === 'note' && <Button size="compact" variant="ghost" disabled={!ready || !!draft} onClick={() => onEdit(entry)}>Edit note</Button>}</article>)}</div>
    </Panel>
  </aside>;
}
