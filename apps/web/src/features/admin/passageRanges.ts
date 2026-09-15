import type { LibraryBook, PackScope, PassageRange, SeasonScope, SourceUnit } from "../../api/types";
export type Coordinate = Pick<SourceUnit, "bookKey" | "chapter" | "verse">;
export const coordinates = (book: LibraryBook): Coordinate[] => book.chapters.flatMap(chapter => chapter.verses.map(verse => ({ bookKey: book.bookKey, chapter: chapter.number, verse })));
export function scopePacks(scope?: SeasonScope | null): PackScope[] { return scope?.packs?.length ? scope.packs : scope?.contentPackId ? [{ contentPackId: scope.contentPackId, includes: scope.includes, excludes: scope.excludes }] : []; }
export const multiScope = (packs: PackScope[]): SeasonScope => ({ contentPackId: null, includes: [], excludes: [], packs });
export const withinRange = (unit: Coordinate, range: PassageRange) => unit.bookKey === range.bookKey && (unit.chapter > range.startChapter || unit.chapter === range.startChapter && unit.verse >= range.startVerse) && (unit.chapter < range.endChapter || unit.chapter === range.endChapter && unit.verse <= range.endVerse);
const same = (a: Coordinate, b: Coordinate) => a.bookKey === b.bookKey && a.chapter === b.chapter && a.verse === b.verse;
export const orderCoordinates = (units: Coordinate[]) => [...units].sort((a,b) => a.bookKey.localeCompare(b.bookKey) || a.chapter-b.chapter || a.verse-b.verse);
/** Split at missing or excluded coordinates so a selected range never bridges unavailable text. */
export function passageSegments(allowed: Coordinate[], all: Coordinate[] = allowed): Coordinate[][] {
  const keys = new Set(allowed.map(u => JSON.stringify([u.bookKey,u.chapter,u.verse])));
  const segments: Coordinate[][] = []; let segment: Coordinate[] = [];
  for (const unit of orderCoordinates(all)) {
    if (!keys.has(JSON.stringify([unit.bookKey,unit.chapter,unit.verse]))) { segment = []; continue; }
    const previous = segment.at(-1);
    if (!previous || previous.bookKey !== unit.bookKey || !(unit.chapter === previous.chapter && unit.verse === previous.verse+1 || unit.chapter === previous.chapter+1 && unit.verse === 1)) { segment = []; segments.push(segment); }
    segment.push(unit);
  }
  return segments;
}
export function storedRange(range: PassageRange, units: Coordinate[], all: Coordinate[] = units) {
  const start = { bookKey: range.bookKey, chapter: range.startChapter, verse: range.startVerse }, end = { bookKey: range.bookKey, chapter: range.endChapter, verse: range.endVerse };
  return passageSegments(units, all).some(segment => { const a=segment.findIndex(u=>same(u,start)), b=segment.findIndex(u=>same(u,end)); return a>=0 && b>=a; });
}
export const firstRange = (units: Coordinate[]): PassageRange | undefined => { const first=orderCoordinates(units)[0]; return first ? { bookKey:first.bookKey,startChapter:first.chapter,startVerse:first.verse,endChapter:first.chapter,endVerse:first.verse } : undefined; };
export const segmentRanges = (allowed: Coordinate[], all: Coordinate[]): PassageRange[] => passageSegments(allowed,all).map(segment => ({ bookKey:segment[0].bookKey,startChapter:segment[0].chapter,startVerse:segment[0].verse,endChapter:segment.at(-1)!.chapter,endVerse:segment.at(-1)!.verse }));
/** Verse-aware citation: "John 3:16", "John 3:16–18", or "John 3:16–4:3". */
export function formatPassageCitation(range: PassageRange): string {
  const { bookKey, startChapter, startVerse, endChapter, endVerse } = range;
  if (startChapter === endChapter) return startVerse === endVerse ? `${bookKey} ${startChapter}:${startVerse}` : `${bookKey} ${startChapter}:${startVerse}–${endVerse}`;
  return `${bookKey} ${startChapter}:${startVerse}–${endChapter}:${endVerse}`;
}
