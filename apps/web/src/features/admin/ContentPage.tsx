import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../api/client";
import type { LibraryBook } from "../../api/types";
import { useAuth } from "../../auth/AuthContext";
import { BookBrowser } from "../../components/scripture/BookBrowser";
import { StudyWorkspace } from "../../components/scripture/StudyWorkspace";
import { PbeMaterialsSection } from "./PbeMaterialsSection";
import { Badge, Button, Notice, PageHeader, Panel, Select } from "../../components/ui";
import { TrainingDialog } from "../../components/ui/TrainingDialog";
import { usePhoneLayout } from "../../hooks/useMediaQuery";
import "./content-library.css";

/** Prev / chapter picker / next as one navigation cluster for the reader toolbar. */
export function ChapterNavigation({ chapters, chapter, onChoose }: {
  chapters: { number: number }[];
  chapter: number | undefined;
  onChoose: (chapter: number) => void;
}) {
  const index = chapters.findIndex(c => c.number === chapter);
  return <div className="reader-navigation"><Button variant="secondary" aria-label="Previous chapter" disabled={index <= 0} onClick={() => onChoose(chapters[index - 1].number)}>←</Button><label>Chapter<Select value={chapter ?? ""} onChange={event => onChoose(Number(event.target.value))}>{chapters.map(c => <option key={c.number} value={c.number}>{c.number}</option>)}</Select></label><Button variant="secondary" aria-label="Next chapter" disabled={index >= chapters.length - 1} onClick={() => onChoose(chapters[index + 1].number)}>→</Button></div>;
}

/** "Books of the Bible" panel: the heading row carries the count and the
 *  browser toggle; the panel sizes to its content (a single row while the
 *  browser is closed). */
export function LibraryBooksPanel({ count, showToggle, browserOpen, onToggle, children }: {
  count: number;
  showToggle: boolean;
  browserOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return <Panel id="library-books" className="library-books-panel"><div className="study-books-heading"><h2>Books of the Bible <Badge>{count}</Badge></h2>{showToggle && <Button variant="secondary" aria-expanded={browserOpen} aria-controls="study-book-browser" onClick={onToggle}>{browserOpen ? 'Hide books' : 'Choose book'}</Button>}</div>{children}</Panel>;
}

export function ContentPage() {
  const { me } = useAuth(), org = me!.organizationId;
  const phone = usePhoneLayout();
  const [browserOpen, setBrowserOpen] = useState(false);
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("book") ?? "", seasonId = params.get("seasonId");
  const library = useQuery({ queryKey: ["library", org], queryFn: () => api.library(org) });
  const progress = useQuery({ queryKey: ["progress", org, me!.userId, seasonId], queryFn: () => api.progress(seasonId!), enabled: !!seasonId, retry: false });
  const assigned = new Set(progress.data?.assignments?.map(assignment => assignment.contentPackId));
  const selected = library.data?.books.find(book => book.contentPackId === selectedId);
  const chapter = selected?.chapters.find(c => c.number === Number(params.get("chapter")))?.number ?? selected?.chapters[0]?.number;
  const units = useQuery({ queryKey: ["library-chapter", org, selectedId, chapter], queryFn: () => api.libraryChapter(org, selectedId, chapter!), enabled: !!selected && !!chapter });
  const choose = (book: string, number: number) => { const next = new URLSearchParams(params); next.set("book", book); next.set("chapter", String(number)); setParams(next, { replace: true }); setBrowserOpen(false); };
  // The book browser's content, shared by the inline panel and the phone
  // bottom sheet (Option D): on phones, once a book is selected, "Choose
  // book" opens the browser as a sheet instead of expanding the panel.
  const bookBrowserInner = (books: LibraryBook[]) => <>
    <p>Explore every book. Read at your own pace.</p>
    {assigned.size > 0 && <p>“Assigned” marks books in your study plan. Reading here does not change training progress.</p>}
    {progress.isError && <Notice>Your assignment markers could not load. All books are still available to read.</Notice>}
    <BookBrowser books={books} renderBook={book => <Button data-testid="library-book" variant={selectedId === book.contentPackId ? "primary" : "secondary"} aria-pressed={selectedId === book.contentPackId} onClick={() => choose(book.contentPackId, book.chapters[0].number)}><span className="content-pack-label"><strong>{book.name}</strong><small>{book.chapters.length} {book.chapters.length === 1 ? "chapter" : "chapters"}</small>{assigned.has(book.contentPackId) && <Badge tone="success">Assigned</Badge>}</span></Button>} />
  </>;
  return <div className="training-page"><PageHeader title="Scripture library" description="New King James Version" />
    {library.isPending ? <Notice>Loading the NKJV library…</Notice> : library.isError ? <Notice tone="danger">{library.error.message} <Button variant="secondary" onClick={() => void library.refetch()}>Retry library</Button></Notice> : <div className="study-library">
      <PbeMaterialsSection org={org} seasonId={seasonId} books={library.data.books} onOpenChapter={choose} />
      <LibraryBooksPanel count={library.data.books.length} showToggle={!!selected} browserOpen={browserOpen} onToggle={() => setBrowserOpen(!browserOpen)}>
        {phone ? (!selected && <div id="study-book-browser">{bookBrowserInner(library.data.books)}</div>) : <div id="study-book-browser" hidden={!!selected && !browserOpen}>{bookBrowserInner(library.data.books)}</div>}
      </LibraryBooksPanel>
      {phone && !!selected && browserOpen && <TrainingDialog open title="Choose book" onClose={() => setBrowserOpen(false)} className="library-book-dialog"><div id="study-book-browser">{bookBrowserInner(library.data.books)}</div></TrainingDialog>}
      {!selected ? <Panel id="library-preview"><h2>A place to read and reflect</h2><p>Choose a book, then a chapter to begin reading.</p></Panel> : <StudyWorkspace key={`${org}:${me!.userId}`} orgId={org} userId={me!.userId} book={selected} chapter={chapter!} units={units.data ?? []} loading={units.isPending} loadError={units.isError} retry={() => void units.refetch()} onNavigate={choose} navigation={<ChapterNavigation chapters={selected.chapters} chapter={chapter} onChoose={number => choose(selectedId, number)} />} />}
    </div>}
  </div>;
}
