import { useEffect } from "react";
import type { PassageRange } from "../../api/types";
import { Select } from "../../components/ui";
import { orderCoordinates, passageSegments, type Coordinate } from "./passageRanges";
export function RangeFields({ prefix, label, range, onChange, books, units, allUnits = units }: { prefix: string; label: string; range: PassageRange; onChange: (range: PassageRange) => void; books?: { bookKey: string; name: string }[]; units: Coordinate[]; allUnits?: Coordinate[] }) {
  const available = orderCoordinates(units);
  const bookKeys = [...new Set(available.map(unit => unit.bookKey))];
  const book = bookKeys.includes(range.bookKey) ? range.bookKey : bookKeys[0];
  const bookUnits = available.filter(unit => unit.bookKey === book);
  const chapterOptions = [...new Set(bookUnits.map(unit => unit.chapter))];
  const startChapter = chapterOptions.includes(range.startChapter) ? range.startChapter : chapterOptions[0];
  const startVerses = [...new Set(bookUnits.filter(unit => unit.chapter === startChapter).map(unit => unit.verse))];
  const startVerse = startVerses.includes(range.startVerse) ? range.startVerse : startVerses[0];
  const segment = passageSegments(units, allUnits).find(segment => segment.some(unit => unit.bookKey === book && unit.chapter === startChapter && unit.verse === startVerse)) ?? [];
  const endUnits = segment.filter(unit => unit.chapter > startChapter || unit.chapter === startChapter && unit.verse >= startVerse);
  const endChapters = [...new Set(endUnits.map(unit => unit.chapter))];
  const endChapter = endChapters.includes(range.endChapter) ? range.endChapter : endChapters[0];
  const endVerses = [...new Set(endUnits.filter(unit => unit.chapter === endChapter).map(unit => unit.verse))];
  const endVerse = endVerses.includes(range.endVerse) ? range.endVerse : endVerses[0];
  useEffect(() => {
    if (book && startVerse !== undefined && endVerse !== undefined && (book !== range.bookKey || startChapter !== range.startChapter || startVerse !== range.startVerse || endChapter !== range.endChapter || endVerse !== range.endVerse)) onChange({ bookKey: book, startChapter, startVerse, endChapter, endVerse });
  }, [book, startChapter, startVerse, endChapter, endVerse, range, onChange]);
  const select = (key: "startChapter" | "startVerse" | "endChapter" | "endVerse", value: number) => {
    const next = { ...range, [key]: value };
    if (key === "startChapter") { next.startVerse = bookUnits.find(unit => unit.chapter === value)!.verse; next.endChapter = value; next.endVerse = next.startVerse; }
    if (key === "startVerse") { next.endChapter = startChapter; next.endVerse = value; }
    if (key === "endChapter") next.endVerse = endUnits.find(unit => unit.chapter === value)!.verse;
    onChange(next);
  };
  return <fieldset className="season-range-fields" disabled={!available.length}><legend>{label}</legend><label className="season-book-field">Book<Select data-testid={prefix + "-book"} value={book ?? ""} onChange={event => { const first = available.find(unit => unit.bookKey === event.target.value)!; onChange({ bookKey: first.bookKey, startChapter: first.chapter, startVerse: first.verse, endChapter: first.chapter, endVerse: first.verse }); }}>{!bookKeys.length && <option value="">No stored passages available</option>}{bookKeys.map(key => <option key={key} value={key}>{books?.find(item => item.bookKey === key)?.name ?? key}</option>)}</Select></label><div className="season-range-numbers">{([{ key: "startChapter", title: "Start chapter", id: "start-chapter", options: chapterOptions, value: startChapter }, { key: "startVerse", title: "Start verse", id: "start", options: startVerses, value: startVerse }, { key: "endChapter", title: "End chapter", id: "end-chapter", options: endChapters, value: endChapter }, { key: "endVerse", title: "End verse", id: "end", options: endVerses, value: endVerse }] as const).map(field => <label key={field.key}>{field.title}<Select required data-testid={prefix + "-" + field.id} value={field.value ?? ""} onChange={event => select(field.key, Number(event.target.value))}>{!field.options.length && <option value="">No verses available</option>}{field.options.map(value => <option key={value} value={value}>{value}</option>)}</Select></label>)}</div><p className="season-help">Only available chapter and verse coordinates are offered.</p></fieldset>;
}
