import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { BookBrowser } from "../../components/scripture/BookBrowser";
import { Badge, Button, Notice, PageHeader, Panel, Select } from "../../components/ui";
import "./content-library.css";
export function ContentPage() {
  const { me } = useAuth(), org = me!.organizationId;
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("book") ?? "", seasonId = params.get("seasonId");
  const library = useQuery({ queryKey: ["library", org], queryFn: () => api.library(org) });
  const progress = useQuery({ queryKey: ["progress", org, me!.userId, seasonId], queryFn: () => api.progress(seasonId!), enabled: !!seasonId, retry: false });
  const assigned = new Set(progress.data?.assignments?.map(assignment => assignment.contentPackId));
  const selected = library.data?.books.find(book => book.contentPackId === selectedId);
  const chapter = selected?.chapters.find(c => c.number === Number(params.get("chapter")))?.number ?? selected?.chapters[0]?.number;
  const units = useQuery({ queryKey: ["library-chapter", org, selectedId, chapter], queryFn: () => api.libraryChapter(org, selectedId, chapter!), enabled: !!selected && !!chapter });
  const choose = (book: string, number: number) => { const next = new URLSearchParams(params); next.set("book", book); next.set("chapter", String(number)); setParams(next, { replace: true }); };
  const index = selected?.chapters.findIndex(c => c.number === chapter) ?? -1;
  return <div className="training-page"><PageHeader title="Scripture library" description="New King James Version" />
    {library.isPending ? <Notice>Loading the NKJV library…</Notice> : library.isError ? <Notice tone="danger">{library.error.message} <Button variant="secondary" onClick={() => void library.refetch()}>Retry library</Button></Notice> : <div className="content-library-grid">
      <Panel id="library-books"><h2>Books of the Bible <Badge>{library.data.books.length}</Badge></h2><p>Explore every book. Read at your own pace.</p>
        {assigned.size > 0 && <p>“Assigned” marks books in your study plan. Reading here does not change training progress.</p>}
        {progress.isError && <Notice>Your assignment markers could not load. All books are still available to read.</Notice>}
        <BookBrowser books={library.data.books} renderBook={book => <Button data-testid="library-book" variant={selectedId === book.contentPackId ? "primary" : "secondary"} aria-pressed={selectedId === book.contentPackId} onClick={() => choose(book.contentPackId, book.chapters[0].number)}><span className="content-pack-label"><strong>{book.name}</strong><small>{book.chapters.length} {book.chapters.length === 1 ? "chapter" : "chapters"}{assigned.has(book.contentPackId) ? " · Assigned" : ""}</small></span></Button>} />
      </Panel>
      <Panel id="library-preview" className="content-verses"><h2>{selected ? `${selected.name} ${chapter}` : "A place to read and reflect"}</h2>{!selected ? <p>Choose a book, then a chapter to begin reading.</p> : <><div className="reader-navigation"><Button variant="secondary" aria-label="Previous chapter" disabled={index <= 0} onClick={() => choose(selectedId, selected.chapters[index - 1].number)}>←</Button><label>Chapter<Select value={chapter ?? ""} onChange={event => choose(selectedId, Number(event.target.value))}>{selected.chapters.map(c => <option key={c.number} value={c.number}>{c.number}</option>)}</Select></label><Button variant="secondary" aria-label="Next chapter" disabled={index >= selected.chapters.length - 1} onClick={() => choose(selectedId, selected.chapters[index + 1].number)}>→</Button></div>
        {units.isPending ? <Notice>Loading verses…</Notice> : units.isError ? <Notice tone="danger">Scripture could not load. <Button variant="secondary" onClick={() => void units.refetch()}>Retry verses</Button></Notice> : <div data-testid="source-unit-list" role="region" aria-label={`${selected.name} chapter ${chapter}`} tabIndex={0}>{units.data.map(unit => <p className="font-serif" key={unit.id}><sup aria-label={`Verse ${unit.verse}`}>{unit.verse}</sup> {unit.canonicalText}</p>)}{!units.data.length && <p>No stored verses are available for this chapter.</p>}</div>}
      </>}</Panel>
    </div>}
  </div>;
}
