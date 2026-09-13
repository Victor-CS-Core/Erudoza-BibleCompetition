import type { RequestContext } from '../types';
import { HttpError, json } from '../types';
import { requireLearner } from './model';
import type { Pack, Source } from './model';
import { LIBRARY_ORG } from './library-access';
export interface LibraryChapter { number: number; verses: number[] }
export interface LibraryBook { contentPackId: string; bookKey: string; name: string; verseCount: number; chapters: LibraryChapter[] }
interface LibraryVersion { translationId: string; translationName: string; version: number; bookCount: number; ready: boolean }
export async function library(ctx: RequestContext): Promise<Response | null> {
  const chapterMatch = ctx.path.match(/^\/library\/books\/([^/]+)\/chapters\/([^/]+)$/);
  if((ctx.path !== '/library' && !chapterMatch) || ctx.request.method !== 'GET') return null;
  await requireLearner(ctx);
  const installed = await ctx.store.get<LibraryVersion>('library-version','nkjv-v1',LIBRARY_ORG);
  if(!installed?.value.ready) throw new HttpError(503,'The NKJV library has not been installed. Contact your administrator.');
  const books = (await ctx.store.list<Pack>('pack',LIBRARY_ORG)).filter(p=>p.isBuiltIn && p.isActive);
  if(books.length !== installed.value.bookCount || books.some(p=>!p.bookKey || !p.bookName || !p.chapters?.length)) throw new HttpError(503,'The NKJV library installation is incomplete. Contact your administrator.');
  if (chapterMatch) {
    const chapter = Number(chapterMatch[2]);
    if (!/^\d+$/.test(chapterMatch[2]) || !Number.isSafeInteger(chapter) || chapter < 1) throw new HttpError(400, 'Choose a valid chapter.');
    const book = books.find(p => p.id === chapterMatch[1]);
    if (!book) throw new HttpError(404, 'Library book not found.');
    const metadata = book.chapters!.find(c => c.number === chapter);
    if (!metadata) throw new HttpError(400, 'Choose a valid chapter.');
    const rows = await ctx.env.DB.prepare("SELECT data FROM Records INDEXED BY Records_owner WHERE kind='source' AND org_id=? AND owner_id=? AND json_extract(data,'$.contentPackId')=? AND json_extract(data,'$.chapter')=? AND json_extract(data,'$.bookKey')=? AND json_extract(data,'$.isActive')=1 AND coalesce(json_extract(data,'$.isRetired'),0)=0 ORDER BY json_extract(data,'$.ordinal'),id LIMIT ?")
      .bind(LIBRARY_ORG, book.id, book.id, chapter, book.bookKey!, metadata.verses.length + 1).all<{ data: string }>();
    const verses = rows.results.map(r => JSON.parse(r.data) as Source);
    if (verses.length !== metadata.verses.length || verses.some(v => !metadata.verses.includes(v.verse))) throw new HttpError(503, 'The NKJV library chapter is incomplete.');
    return json(verses.map(({id,citation,bookKey,chapter,verse,ordinal,canonicalText}) => ({id,citation,bookKey,chapter,verse,ordinal,canonicalText})));
  }
  return json({ translationId:installed.value.translationId,translationName:installed.value.translationName,version:installed.value.version,
    books:books.sort((a,b)=>(a.bookOrdinal??0)-(b.bookOrdinal??0)).map(p=>({contentPackId:p.id,bookKey:p.bookKey,name:p.bookName,verseCount:p.unitCount,chapters:p.chapters})) });
}
