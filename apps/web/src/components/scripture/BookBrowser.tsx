import { useState, type ReactNode } from "react";
import type { LibraryBook } from "../../api/types";
import { Input } from "../ui";
const newTestament = new Set("MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV".split(" "));
export function BookBrowser({ books, renderBook }: { books: LibraryBook[]; renderBook: (book: LibraryBook) => ReactNode }) {
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const filtered = books.filter(book => `${book.name} ${book.bookKey}`.toLowerCase().includes(query));
  return <div className="bible-browser"><label className="content-library-search">Search books<Input type="search" value={search} placeholder="Find a book of the Bible" onChange={event => setSearch(event.target.value)} /></label>
    {query && books.length > 0 && <p className="bible-search-count" aria-live="polite">{filtered.length} of {books.length} books</p>}
    {!filtered.length && <p>{books.length ? "No books match your search." : "The library has no installed books."}</p>}
    <div className="bible-book-groups">{[false, true].map(isNew => {
      const group = filtered.filter(book => newTestament.has(book.bookKey) === isNew);
      return group.length > 0 && <section key={String(isNew)} aria-label={isNew ? "New Testament" : "Old Testament"}><h3>{isNew ? "New Testament" : "Old Testament"} <span className="bible-book-count">· {group.length}</span></h3><div className="bible-book-options">{group.map(book => <div key={book.contentPackId}>{renderBook(book)}</div>)}</div></section>;
    })}</div>
  </div>;
}
