import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { Badge, Button, Input, LinkButton, Notice, PageHeader, Panel, Select } from "../../components/ui";
import "./content-library.css";
export function ContentPage() {
  const { me } = useAuth(), org = me!.organizationId;
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [selectedChapter, setSelectedChapter] = useState<number | null>(null);
  const library = useQuery({ queryKey: ["library", org], queryFn: () => api.library(org) });
  const selected = library.data?.books.find(book => book.contentPackId === selectedId);
  const chapter = selected?.chapters.find(c => c.number === selectedChapter)?.number ?? selected?.chapters[0]?.number;
  const units = useQuery({ queryKey: ["source-units", org, selectedId], queryFn: () => api.sourceUnits(org, selectedId), enabled: !!selected });
  const books = library.data?.books.filter(book => (book.name + " " + book.bookKey).toLowerCase().includes(search.trim().toLowerCase())) ?? [];
  return <div className="training-page"><PageHeader title="Scripture library" description="New King James Version" action={<LinkButton to="/admin/seasons">Choose season passages</LinkButton>} />
    {library.isPending ? <Notice>Loading the NKJV library…</Notice> : library.isError ? <Notice tone="danger">{library.error.message} <Button variant="secondary" onClick={() => void library.refetch()}>Retry library</Button></Notice> : <div className="content-library-grid">
      <Panel id="library-books"><h2>Books of the Bible <Badge>{library.data.books.length}</Badge></h2><p>Choose passages from the shared NKJV library for each season and student.</p>
        <label className="content-library-search">Search books<Input type="search" value={search} placeholder="Book name" onChange={event => setSearch(event.target.value)} /></label>
        {!books.length && <p>{library.data.books.length ? "No books match your search." : "The library has no installed books."}</p>}
        <ul className="content-pack-list">{books.map(book => <li key={book.contentPackId} className="content-pack-row"><Button data-testid="library-book" variant={selectedId === book.contentPackId ? "primary" : "secondary"} aria-pressed={selectedId === book.contentPackId} onClick={() => { setSelectedId(book.contentPackId); setSelectedChapter(null); }}><span className="content-pack-label"><strong>{book.name}</strong><span>{book.chapters.length} chapters · {book.verseCount} verses</span></span></Button></li>)}</ul>
      </Panel>
      <Panel id="library-preview" className="content-verses"><h2>{selected?.name ?? "Preview Scripture"}</h2>{!selected ? <p>Select a book to read its stored verses.</p> : <><label>Preview chapter<Select value={chapter ?? ""} onChange={event => setSelectedChapter(Number(event.target.value))}>{selected.chapters.map(c => <option key={c.number} value={c.number}>{c.number}</option>)}</Select></label>
        {units.isPending ? <Notice>Loading verses…</Notice> : units.isError ? <Notice tone="danger">Stored verses could not load. <Button variant="secondary" onClick={() => void units.refetch()}>Retry verses</Button></Notice> : <div data-testid="source-unit-list" role="region" aria-label="Stored verses" tabIndex={0}>{units.data.filter(u => u.chapter === chapter).map(unit => <article key={unit.id}><h3>{unit.citation}</h3><p className="font-serif">{unit.canonicalText}</p></article>)}{!units.data.some(u => u.chapter === chapter) && <p>No stored verses are available for this chapter.</p>}</div>}
      </>}</Panel>
    </div>}
  </div>;
}
