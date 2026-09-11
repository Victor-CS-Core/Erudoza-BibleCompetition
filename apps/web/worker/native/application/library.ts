import type { RequestContext } from '../types';
import { HttpError, json } from '../types';
import type { Pack } from './model';
import { LIBRARY_ORG } from './library-access';
export interface LibraryChapter { number: number; verses: number[] }
export interface LibraryBook { contentPackId: string; bookKey: string; name: string; verseCount: number; chapters: LibraryChapter[] }
interface LibraryVersion { translationId: string; translationName: string; version: number; bookCount: number; ready: boolean }
export async function library(ctx: RequestContext): Promise<Response | null> {
  if(ctx.path !== '/library' || ctx.request.method !== 'GET') return null;
  const installed = await ctx.store.get<LibraryVersion>('library-version','nkjv-v1',LIBRARY_ORG);
  if(!installed?.value.ready) throw new HttpError(503,'The NKJV library has not been installed. Contact your administrator.');
  const books = (await ctx.store.list<Pack>('pack',LIBRARY_ORG)).filter(p=>p.isBuiltIn && p.isActive);
  if(books.length !== installed.value.bookCount || books.some(p=>!p.bookKey || !p.bookName || !p.chapters?.length)) throw new HttpError(503,'The NKJV library installation is incomplete. Contact your administrator.');
  return json({ translationId:installed.value.translationId,translationName:installed.value.translationName,version:installed.value.version,
    books:books.sort((a,b)=>(a.bookOrdinal??0)-(b.bookOrdinal??0)).map(p=>({contentPackId:p.id,bookKey:p.bookKey,name:p.bookName,verseCount:p.unitCount,chapters:p.chapters})) });
}
