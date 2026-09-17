import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api/client";
import type { LibraryBook, PbeMaterial, PbeMaterialSummary } from "../../api/types";
import { Badge, Button, ExternalLinkButton, LoadingState, Notice, Panel } from "../../components/ui";
import { formatPbeYearLabel, formatChapters } from "./MaterialsPage";
import "./content-library.css";

type PbeLibraryMaterial = {
  yearLabel: string;
  books: { bookKey: string; bookName: string; chapters: number[] }[];
  commentaryTitle: string;
  commentaryBookName: string;
  sections: { heading: string; body: string | null }[];
  versesPdf?: string;
  commentaryPdf?: string;
  resourcesPage: string;
  full: boolean;
};

function fromMaterial(material: PbeMaterial): PbeLibraryMaterial {
  return {
    yearLabel: material.yearLabel,
    books: material.books,
    commentaryTitle: material.commentary.title,
    commentaryBookName: material.commentary.bookName,
    sections: material.commentary.sections.map(section => ({ heading: section.heading, body: section.body })),
    versesPdf: material.sourceUrls.versesPdf,
    commentaryPdf: material.sourceUrls.commentaryPdf,
    resourcesPage: material.sourceUrls.resourcesPage,
    full: true,
  };
}

function fromSummary(summary: PbeMaterialSummary): PbeLibraryMaterial {
  return {
    yearLabel: summary.yearLabel,
    books: summary.books,
    commentaryTitle: summary.commentary.title,
    commentaryBookName: summary.commentary.bookName,
    sections: summary.commentary.sectionHeadings.map(heading => ({ heading, body: null })),
    versesPdf: summary.sourceUrls.versesPdf,
    commentaryPdf: summary.sourceUrls.commentaryPdf,
    resourcesPage: summary.sourceUrls.resourcesPage,
    full: false,
  };
}

/** "This year's PBE materials" — the year roster, commentary introduction, and recall flashcards. */
export function PbeMaterialsSection({ org, seasonId, books, onOpenChapter }: {
  org: string;
  seasonId: string | null;
  books: LibraryBook[];
  onOpenChapter: (packId: string, chapter: number) => void;
}) {
  const current = useQuery({
    queryKey: ["pbe-material-current", org, seasonId ?? "latest"],
    queryFn: async (): Promise<PbeLibraryMaterial | null> => {
      if (seasonId) {
        const { material } = await api.pbeMaterialCurrent(org, seasonId);
        return material ? fromMaterial(material) : null;
      }
      const summaries = await api.pbeMaterials(org);
      const latest = [...summaries].sort((a, b) => b.yearLabel.localeCompare(a.yearLabel))[0];
      return latest ? fromSummary(latest) : null;
    },
    retry: false,
  });

  return <Panel id="pbe-materials">
    <div className="study-books-heading"><h2>This year's PBE materials</h2>{current.data && <Badge>{formatPbeYearLabel(current.data.yearLabel)}</Badge>}</div>
    {current.isPending ? <LoadingState label="Loading this year's PBE materials…" />
      : current.isError ? <Notice tone="danger">This year's PBE materials could not load. <Button variant="secondary" size="compact" onClick={() => void current.refetch()}>Try again</Button></Notice>
      : !current.data ? <p>This year's materials haven't been released yet.</p>
      : <PbeMaterialBody material={current.data} seasonId={seasonId} books={books} onOpenChapter={onOpenChapter} />}
  </Panel>;
}

function PbeMaterialBody({ material, seasonId, books, onOpenChapter }: {
  material: PbeLibraryMaterial;
  seasonId: string | null;
  books: LibraryBook[];
  onOpenChapter: (packId: string, chapter: number) => void;
}) {
  return <div className="pbe-material-body">
    {!seasonId && <p className="materials-hint">Showing the most recent released year. Open a season to see that season's materials.</p>}
    <h3>Book roster</h3>
    <div className="pbe-roster-chips">
      {material.books.map(book => {
        const pack = books.find(candidate => candidate.bookKey === book.bookKey);
        const label = `${book.bookName} · ${formatChapters(book.chapters)}`;
        return pack
          ? <Button key={book.bookKey} variant="secondary" size="compact" onClick={() => onOpenChapter(pack.contentPackId, book.chapters[0])} aria-label={`Read ${book.bookName} in the chapter reader`}>{label}</Button>
          : <Badge key={book.bookKey}>{label}</Badge>;
      })}
    </div>
    {(material.versesPdf || material.resourcesPage) && <div className="materials-sources">
      <ExternalLinkButton variant="secondary" size="compact" href={material.versesPdf ?? material.resourcesPage} target="_blank" rel="noreferrer">View original</ExternalLinkButton>
    </div>}
    <h3>Commentary introduction</h3>
    <p className="materials-commentary-title"><strong>{material.commentaryTitle}</strong> <span>· {material.commentaryBookName}</span></p>
    {(material.commentaryPdf || material.resourcesPage) && <div className="materials-sources">
      <ExternalLinkButton variant="secondary" size="compact" href={material.commentaryPdf ?? material.resourcesPage} target="_blank" rel="noreferrer">View original</ExternalLinkButton>
    </div>}
    {material.full
      ? <>
        {material.sections.map((section, index) => <section key={index} className="materials-section"><h4>{section.heading}</h4><p className="materials-section-body">{section.body}</p></section>)}
        <PbeFlashcards sections={material.sections as { heading: string; body: string }[]} />
      </>
      : <>
        <ul className="pbe-section-outline">{material.sections.map(section => <li key={section.heading}>{section.heading}</li>)}</ul>
        <p className="materials-hint">Choose a season to read the full introduction and practice with flashcards.</p>
      </>}
  </div>;
}

function PbeFlashcards({ sections }: { sections: { heading: string; body: string }[] }) {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  if (!sections.length) return null;
  const section = sections[index % sections.length];
  const hint = section.body.split(/\s+/).slice(0, 12).join(" ");
  const go = (next: number) => { setIndex((next + sections.length) % sections.length); setFlipped(false); };
  return <div className="pbe-flashcards">
    <h3>Recall flashcards</h3>
    <div className="pbe-flashcard" data-testid="pbe-flashcard">
      <div className="pbe-flashcard-inner" key={`${index}-${flipped ? "back" : "front"}`}>
      {!flipped
        ? <><p className="pbe-flashcard-question">What does the introduction say about {section.heading}?</p><p className="pbe-flashcard-hint">Hint: {hint}…</p></>
        : <p className="pbe-flashcard-answer">{section.body}</p>}
      </div>
    </div>
    <div className="pbe-flashcard-controls">
      <Button variant="secondary" size="compact" onClick={() => go(index - 1)} aria-label="Previous flashcard">← Prev</Button>
      <span className="pbe-flashcard-count" aria-live="polite">{(index % sections.length) + 1} of {sections.length}</span>
      <Button variant="secondary" size="compact" onClick={() => setFlipped(!flipped)}>{flipped ? "Show question" : "Show answer"}</Button>
      <Button variant="secondary" size="compact" onClick={() => go(index + 1)} aria-label="Next flashcard">Next →</Button>
    </div>
  </div>;
}
