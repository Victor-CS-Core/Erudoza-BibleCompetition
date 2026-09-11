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

export function ScriptureReader({ seasonId, citation, onRead }: {
  seasonId: string;
  citation?: string;
  onRead: () => void;
}) {
  const { me } = useAuth();
  const [open, setOpen] = useState(false);
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
      <Button variant="secondary" aria-expanded={open} aria-controls={regionId} onClick={() => setOpen(value => !value)}>
        {open ? "Hide passage" : "Read passage"}
      </Button>
    </div>
    <div id={regionId} hidden={!open}>
      {assigned.isFetching && <LoadingState label="Loading your assigned passages…" />}
      {assigned.isError && <Notice tone="danger">Your passages could not load. <Button variant="secondary" onClick={() => void assigned.refetch()}>Try loading passages again</Button></Notice>}
      {assigned.data && !assigned.isError && <div hidden={assigned.isFetching}>{assigned.data.verses.length
        ? <ScripturePassages key={seasonId} verses={assigned.data.verses} citation={citation} />
        : <EmptyState title="No passages available" description="Your coach needs to assign readable passages in this season before they appear here." />}</div>}
    </div>
  </Panel>;
}

function ScripturePassages({ verses, citation }: { verses: SourceUnit[]; citation?: string }) {
  const preferred = verses.find(verse => verse.citation === citation) ?? verses[0];
  const [book, setBook] = useState(preferred.bookKey);
  const [chapter, setChapter] = useState(preferred.chapter);
  const [verseNumber, setVerseNumber] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
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
    <div className="scripture-reader-navigation">
      <label>Book<Select value={selectedBook} disabled={isSearching} onChange={event => { setBook(event.target.value); setChapter(0); setVerseNumber(""); setPage(0); }}>
        {books.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
      </Select></label>
      <label>Chapter<Select value={selectedChapter} disabled={isSearching} onChange={event => { setChapter(Number(event.target.value)); setVerseNumber(""); setPage(0); }}>
        {chapters.map(value => <option key={value} value={value}>{value}</option>)}
      </Select></label>
      <label>Verse<Select value={selectedVerse} disabled={isSearching} onChange={event => { setVerseNumber(event.target.value); setPage(0); }}>
        <option value="">Whole chapter</option>
        {chapterVerses.map(verse => <option key={verse.id} value={verse.verse}>{verse.verse}</option>)}
      </Select></label>
    </div>
    <label>Search assigned Scripture<Input type="search" value={query} placeholder="Words or a reference, such as John 3:16" onChange={event => { setQuery(event.target.value); setPage(0); }} /></label>
    {isSearching && <div className="scripture-reader-heading"><p className="text-sm">Search covers all your assigned passages.</p><Button size="compact" variant="ghost" onClick={() => { setQuery(""); setPage(0); }}>Clear search</Button></div>}
    <p role="status" className="text-sm">{matches.length === 0 ? "No matching verses" : `${matches.length} ${matches.length === 1 ? "verse" : "verses"}${matches.length > PAGE_SIZE ? ` · Showing ${currentPage * PAGE_SIZE + 1}–${Math.min((currentPage + 1) * PAGE_SIZE, matches.length)}` : ""}`}</p>
    {matches.length === 0 && <EmptyState title="No verses match this search" description="Try different words or a book and chapter reference from your assigned passages." />}
    <ol className="scripture-reader-verses" aria-label="Scripture verses">
      {visible.map(verse => <li key={verse.id}><p className="text-sm font-medium">{verse.citation}</p><p className="er-scripture leading-relaxed">{verse.canonicalText}</p></li>)}
    </ol>
    {matches.length > PAGE_SIZE && <nav aria-label="Verse result pages" className="scripture-reader-heading">
      <Button variant="secondary" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous verses</Button>
      <p className="text-sm">Page {currentPage + 1} of {lastPage + 1}</p>
      <Button variant="secondary" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>Next verses</Button>
    </nav>}
  </div>;
}
