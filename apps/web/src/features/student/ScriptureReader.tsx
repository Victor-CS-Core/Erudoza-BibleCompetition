import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { scriptureApi } from "../../api/scripture";
import type { SourceUnit } from "../../api/types";
import { useAuth } from "../../auth/AuthContext";
import { Button, EmptyState, Input, LoadingState, Notice, Panel, Select } from "../../components/ui";
import "./scripture-reader.css";

const PAGE_SIZE = 40;
const bookName = (verse: SourceUnit) => verse.citation.replace(/\s+\d+:\d+.*$/, "");
const normalize = (text: string) => text.toLocaleLowerCase().replace(/\s+/g, " ").trim();

export function searchScripture(verses: SourceUnit[], query: string): SourceUnit[] {
  const text = normalize(query);
  const reference = text.match(/^(.+?)\s+(\d+)(?::(\d+)(?:\s*[-–]\s*(\d+))?)?$/);
  if (reference) {
    const [, book, chapter, firstVerse, lastVerse] = reference;
    return verses.filter(verse => (normalize(verse.bookKey) === book || normalize(bookName(verse)) === book)
      && verse.chapter === Number(chapter)
      && (!firstVerse || verse.verse >= Number(firstVerse) && verse.verse <= Number(lastVerse || firstVerse)));
  }
  return verses.filter(verse => normalize(`${verse.citation} ${verse.canonicalText}`).includes(text));
}

/** The passage one practice card is about. `citation` is the card's own
 * reference (a single verse, or a range when a unit spans verses);
 * `nextVerse` marks What Comes Next, whose practiced item is the verse
 * AFTER the cited one. */
export type ReaderFocus = { citation: string; nextVerse?: boolean };

/** Resolve a card's focus to the exact assigned verses it practices, in
 * reading order. Returns [] when the reference cannot be resolved inside
 * the assigned set — callers then fall back to the chapter browser, so a
 * focus miss never hides Scripture the learner is allowed to read. */
export function focusVerses(verses: SourceUnit[], focus: ReaderFocus): SourceUnit[] {
  const reference = focus.citation.trim().match(/^(.+?)\s+(\d+):(\d+)(?:\s*[-–]\s*(\d+))?$/);
  if (!reference) return [];
  const [, book, chapter, firstVerse, lastVerse] = reference;
  const base = verses.filter(verse => (normalize(verse.bookKey) === normalize(book) || normalize(bookName(verse)) === normalize(book))
    && verse.chapter === Number(chapter)
    && verse.verse >= Number(firstVerse) && verse.verse <= Number(lastVerse || firstVerse))
    .sort((a, b) => a.ordinal - b.ordinal);
  if (!base.length) return [];
  if (!focus.nextVerse) return base;
  const after = Math.max(...base.map(verse => verse.ordinal));
  const next = verses.filter(verse => verse.ordinal > after).sort((a, b) => a.ordinal - b.ordinal)[0];
  return next ? [next] : [];
}

const focusKeyOf = (focus?: ReaderFocus) => focus ? `${focus.citation}|${focus.nextVerse ? "next" : "self"}` : "";
const focusHeading = (focused: SourceUnit[]) => {
  const first = focused[0], last = focused[focused.length - 1];
  if (focused.length === 1) return first.citation;
  return first.chapter === last.chapter && first.bookKey === last.bookKey ? `${first.citation}–${last.verse}` : `${first.citation} – ${last.citation}`;
};

export function ScriptureReader({ seasonId, citation, focus, onRead, open: openProp, onOpenChange }: {
  seasonId: string;
  citation?: string;
  /** In-session focus: when the session names the passage its current card
   * practices, the reader opens on exactly that passage instead of the
   * whole chapter. Omit for the plain chapter browser. */
  focus?: ReaderFocus;
  onRead: () => void;
  /** Controlled open state (StudyPage lifts it so navigation to a
   * from-memory activity can hide the passage automatically). When omitted
   * the reader manages its own state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { me } = useAuth();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = (next: boolean) => { if (onOpenChange) onOpenChange(next); else setInternalOpen(next); };
  const regionId = useId();
  const assigned = useQuery({
    queryKey: ["assigned-scripture", seasonId, me?.organizationId, me?.userId],
    queryFn: () => scriptureApi.assigned(seasonId),
    enabled: open,
    retry: false,
  });
  useEffect(() => {
    if (open && assigned.isSuccess && !assigned.isFetching && assigned.data.verses.length) onRead();
  }, [open, assigned.isSuccess, assigned.isFetching, assigned.data, onRead]);

  return <Panel aria-label="Assigned Scripture" className="scripture-reader">
    <div className="scripture-reader-heading">
      <div><h2>Assigned Scripture</h2><p className="text-sm">Read and search your passages while you study.</p></div>
      <Button variant="secondary" aria-expanded={open} aria-controls={regionId} onClick={() => setOpen(!open)}>
        {open ? "Hide passage" : "Read passage"}
      </Button>
    </div>
    <div id={regionId} hidden={!open}>
      {assigned.isFetching && <LoadingState label="Loading your assigned passages…" />}
      {assigned.isError && <Notice tone="danger">Your passages could not load. <Button variant="secondary" onClick={() => void assigned.refetch()}>Try loading passages again</Button></Notice>}
      {assigned.data && !assigned.isError && <div hidden={assigned.isFetching}>{assigned.data.verses.length
        ? <ScripturePassages key={seasonId} verses={assigned.data.verses} citation={citation} focus={focus} />
        : <EmptyState title="No passages available" description="Your coach needs to assign readable passages in this season before they appear here." />}</div>}
    </div>
  </Panel>;
}

function ScripturePassages({ verses, citation, focus }: { verses: SourceUnit[]; citation?: string; focus?: ReaderFocus }) {
  const preferred = verses.find(verse => verse.citation === citation) ?? verses[0];
  const [book, setBook] = useState(preferred.bookKey);
  const [chapter, setChapter] = useState(preferred.chapter);
  const [verseNumber, setVerseNumber] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  // Focused-passage state: `escapedKey` records which card focus the
  // learner left for the chapter browser; `browseTouched` records that
  // they actually navigated or searched there. A card change re-focuses
  // the reader on the new card's passage — unless the learner is mid-
  // browse (a search or navigation in progress keeps its place, the
  // behavior the session tests have always pinned).
  const [escapedKey, setEscapedKey] = useState<string | null>(null);
  const [browseTouched, setBrowseTouched] = useState(false);
  const focusKey = focusKeyOf(focus);
  const focused = focus ? focusVerses(verses, focus) : [];
  const browsing = escapedKey !== null && (escapedKey === focusKey || browseTouched);
  if (focused.length && !browsing) {
    return <div className="scripture-reader-content scripture-reader-content--focused" data-testid="reader-focused-passage">
      <p className="text-sm scripture-reader-hint">Reading before checking an answer counts as using a study hint. This is the passage this card practices.</p>
      <div className="scripture-reader-passage">
        <h3 className="scripture-reader-focus-title">{focusHeading(focused)}</h3>
        <ol className="scripture-reader-verses scripture-reader-verses--focused" aria-label="Scripture verses">
          {focused.map(verse => <li key={verse.id}><p className="er-scripture leading-relaxed"><sup className="scripture-reader-verse-num">{verse.verse}</sup>{verse.canonicalText}</p></li>)}
        </ol>
      </div>
      <div><Button size="compact" variant="ghost" onClick={() => setEscapedKey(focusKey)}>Browse the full chapter instead</Button></div>
    </div>;
  }
  const books = [...new Map(verses.map(verse => [verse.bookKey, bookName(verse)])).entries()];
  const selectedBook = books.some(([key]) => key === book) ? book : books[0][0];
  const chapters = [...new Set(verses.filter(verse => verse.bookKey === selectedBook).map(verse => verse.chapter))].sort((a, b) => a - b);
  const selectedChapter = chapters.includes(chapter) ? chapter : chapters[0];
  const chapterVerses = verses.filter(verse => verse.bookKey === selectedBook && verse.chapter === selectedChapter);
  const selectedVerse = chapterVerses.some(verse => String(verse.verse) === verseNumber) ? verseNumber : "";
  const isSearching = !!query.trim();
  const matches = isSearching ? searchScripture(verses, query)
    : chapterVerses.filter(verse => !selectedVerse || verse.verse === Number(selectedVerse));
  const lastPage = Math.max(0, Math.ceil(matches.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const visible = matches.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  return <div className="scripture-reader-content">
    <p className="text-sm">Reading before checking an answer counts as using a study hint. Only passages assigned to you are available.</p>
    {focused.length > 0 && <div><Button size="compact" variant="ghost" onClick={() => { setEscapedKey(null); setBrowseTouched(false); }}>Back to this card's passage</Button></div>}
    <div className="scripture-reader-navigation">
      <label>Book<Select value={selectedBook} disabled={isSearching} onChange={event => { setBrowseTouched(true); setBook(event.target.value); setChapter(0); setVerseNumber(""); setPage(0); }}>
        {books.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
      </Select></label>
      <label>Chapter<Select value={selectedChapter} disabled={isSearching} onChange={event => { setBrowseTouched(true); setChapter(Number(event.target.value)); setVerseNumber(""); setPage(0); }}>
        {chapters.map(value => <option key={value} value={value}>{value}</option>)}
      </Select></label>
      <label>Verse<Select value={selectedVerse} disabled={isSearching} onChange={event => { setBrowseTouched(true); setVerseNumber(event.target.value); setPage(0); }}>
        <option value="">Whole chapter</option>
        {chapterVerses.map(verse => <option key={verse.id} value={verse.verse}>{verse.verse}</option>)}
      </Select></label>
    </div>
    <label>Search assigned Scripture<Input type="search" value={query} placeholder="Words or a reference, such as John 3:16" onChange={event => { setBrowseTouched(true); setQuery(event.target.value); setPage(0); }} /></label>
    {isSearching && <div className="scripture-reader-heading"><p className="text-sm">Search covers all your assigned passages.</p><Button size="compact" variant="ghost" onClick={() => { setBrowseTouched(true); setQuery(""); setPage(0); }}>Clear search</Button></div>}
    <p role="status" className="text-sm">{matches.length === 0 ? "No matching verses" : `${matches.length} ${matches.length === 1 ? "verse" : "verses"}${matches.length > PAGE_SIZE ? ` · Showing ${currentPage * PAGE_SIZE + 1}–${Math.min((currentPage + 1) * PAGE_SIZE, matches.length)}` : ""}`}</p>
    {matches.length === 0 && <EmptyState title="No verses match this search" description="Try different words or a book and chapter reference from your assigned passages." />}
    <ol className="scripture-reader-verses" aria-label="Scripture verses">
      {visible.map(verse => <li key={verse.id}><p className="text-sm font-medium">{verse.citation}</p><p className="er-scripture leading-relaxed">{verse.canonicalText}</p></li>)}
    </ol>
    {matches.length > PAGE_SIZE && <nav aria-label="Verse result pages" className="scripture-reader-heading">
      <Button variant="secondary" disabled={currentPage === 0} onClick={() => { setBrowseTouched(true); setPage(currentPage - 1); }}>Previous verses</Button>
      <p className="text-sm">Page {currentPage + 1} of {lastPage + 1}</p>
      <Button variant="secondary" disabled={currentPage === lastPage} onClick={() => { setBrowseTouched(true); setPage(currentPage + 1); }}>Next verses</Button>
    </nav>}
  </div>;
}
