import type { RequestContext } from '../types';
import { body, HttpError, json, requiredString } from '../types';
import { fail, integer } from './model';
import { importPack } from './content';
const translations = [['web', 'World English Bible'], ['kjv', 'King James Version'], ['asv', 'American Standard Version (1901)'], ['bbe', 'Bible in Basic English'], ['webbe', 'World English Bible, British Edition'], ['oeb-us', 'Open English Bible, US Edition']].map(([id, name]) => ({ id, name, license: 'Public Domain', language: 'English' }));
const books = 'GEN:Genesis|EXO:Exodus|LEV:Leviticus|NUM:Numbers|DEU:Deuteronomy|JOS:Joshua|JDG:Judges|RUT:Ruth|1SA:1 Samuel|2SA:2 Samuel|1KI:1 Kings|2KI:2 Kings|EZR:Ezra|NEH:Nehemiah|EST:Esther|JOB:Job|PSA:Psalms|PRO:Proverbs|ECC:Ecclesiastes|SNG:Song of Songs|ISA:Isaiah|JER:Jeremiah|LAM:Lamentations|EZK:Ezekiel|DAN:Daniel|HOS:Hosea|JOL:Joel|AMO:Amos|OBA:Obadiah|JON:Jonah|MIC:Micah|NAM:Nahum|HAB:Habakkuk|ZEP:Zephaniah|HAG:Haggai|ZEC:Zechariah|MAL:Malachi|MAT:Matthew|MRK:Mark|LUK:Luke|JHN:John|ACT:Acts|ROM:Romans|1CO:1 Corinthians|2CO:2 Corinthians|GAL:Galatians|EPH:Ephesians|PHP:Philippians|COL:Colossians|1TH:1 Thessalonians|2TH:2 Thessalonians|1TI:1 Timothy|2TI:2 Timothy|TIT:Titus|PHM:Philemon|HEB:Hebrews|JAS:James|1PE:1 Peter|2PE:2 Peter|1JN:1 John|2JN:2 John|3JN:3 John|JUD:Jude|REV:Revelation'.split('|').map(s => { const [bookKey, name] = s.split(':'); return { bookKey, name }; });
type Book = { bookKey: string; name: string };
const metadataCache = new Map<string, { expires: number; value: unknown }>();
async function metadata<T>(path: string): Promise<T> {
    const cached = metadataCache.get(path);
    if (cached && cached.expires > Date.now()) return cached.value as T;
    let response: Response;
    try { response = await fetch(`https://bible-api.com/data/${path}`, { signal: AbortSignal.timeout(15000), redirect: 'error' }); }
    catch { throw new HttpError(502, 'The Scripture catalog is unavailable. Try again in a moment.'); }
    if (!response.ok) throw new HttpError(502, 'Available books or chapters could not load. Try again in a moment.');
    let value: T;
    try { value = await body<T>(new Request('https://catalog.invalid', { method: 'POST', body: response.body, duplex: 'half' } as RequestInit), 128000); }
    catch { throw new HttpError(502, 'The catalog returned unreadable book information. Try again later.'); }
    return value;
}
function rememberMetadata(path: string, value: unknown) {
    if (metadataCache.size >= 512) metadataCache.delete(metadataCache.keys().next().value!);
    metadataCache.set(path, { expires: Date.now() + 6 * 3600000, value });
}
async function availableBooks(translationId: string): Promise<Book[]> {
    const data = await metadata<{ books: { id: string; name: string }[] }>(translationId);
    if (!data || !Array.isArray(data.books) || !data.books.length || data.books.some(book => !book || typeof book.id !== 'string' || !/^[A-Z0-9]{3,4}$/.test(book.id) || typeof book.name !== 'string' || !book.name.trim())) throw new HttpError(502, 'The catalog returned unreadable book information.');
    rememberMetadata(translationId, data);
    return data.books.map(book => ({ bookKey: book.id, name: book.name }));
}
async function availableChapters(translationId: string, bookKey: string): Promise<number[]> {
    const data = await metadata<{ chapters: { book_id: string; chapter: number }[] }>(`${translationId}/${bookKey}`);
    if (!data || !Array.isArray(data.chapters) || !data.chapters.length || data.chapters.some(c => !c || c.book_id !== bookKey || !Number.isSafeInteger(c.chapter) || c.chapter < 1)) throw new HttpError(502, 'The catalog returned unreadable chapter information.');
    rememberMetadata(`${translationId}/${bookKey}`, data);
    return [...new Set(data.chapters.map(c => c.chapter))].sort((a, b) => a - b);
}
interface Chapter {
    translation: {
        identifier: string;
        license: string;
    };
    verses: {
        book_id: string;
        chapter: number;
        verse: number;
        text: string;
    }[];
}
export async function catalog(ctx: RequestContext): Promise<Response | null> {
    if (ctx.path === '/scripture-catalog' && ctx.request.method === 'GET')
        return json({ translations, books });
    const chaptersRoute = ctx.path.match(/^\/scripture-catalog\/books\/([A-Za-z0-9]{3,4})\/chapters$/);
    if (ctx.request.method === 'GET' && (ctx.path === '/scripture-catalog/books' || chaptersRoute)) {
        const translation = translations.find(t => t.id === new URL(ctx.request.url).searchParams.get('translationId'));
        if (!translation) return fail('Choose a translation from the public-domain catalog.');
        const available = await availableBooks(translation.id);
        if (!chaptersRoute) return json(available);
        const book = available.find(b => b.bookKey === chaptersRoute[1].toUpperCase());
        if (!book) return fail('Choose a book available in the selected translation.');
        return json({ chapters: await availableChapters(translation.id, book.bookKey), maxChaptersPerImport: 8 });
    }
    if (ctx.path !== '/content-packs/import-from-catalog' || ctx.request.method !== 'POST')
        return null;
    const input = await body<{
        translationId: string;
        bookKey: string;
        startChapter: number;
        endChapter: number;
    }>(ctx.request, 4096);
    const translation = translations.find(t => t.id === String(input.translationId).toLowerCase());
    if (!translation)
        return fail('Choose a translation and book from the public-domain catalog.');
    const book = (await availableBooks(translation.id)).find(b => b.bookKey === String(input.bookKey).toUpperCase());
    if (!book) return fail('Choose a book available in the selected translation.');
    const start = integer(input.startChapter, 'Start chapter', 150), end = integer(input.endChapter, 'End chapter', 150);
    if (end < start || end - start >= 8)
        return fail('Import 1 to 8 consecutive chapters.');
    const allowedChapters = await availableChapters(translation.id, book.bookKey);
    if (Array.from({ length: end - start + 1 }, (_, i) => start + i).some(chapter => !allowedChapters.includes(chapter))) return fail(`Choose chapters available in ${book.name} for this translation.`);
    const units: {
        citation: string;
        bookKey: string;
        chapter: number;
        verse: number;
        ordinal: number;
        text: string;
    }[] = [];
    for (let chapter = start; chapter <= end; chapter++) {
        let response: Response;
        try {
            response = await fetch(`https://bible-api.com/data/${translation.id}/${book.bookKey}/${chapter}`, { signal: AbortSignal.timeout(15000), redirect: 'error' });
        }
        catch {
            throw new HttpError(502, 'The Scripture catalog could not load that chapter.');
        }
        if (!response.ok)
            throw new HttpError(502, 'The Scripture catalog could not load that chapter.');
        const parsed = await body<Chapter>(new Request('https://catalog.invalid', { method: 'POST', body: response.body, duplex: 'half' } as RequestInit), 512000);
        if (parsed.translation?.identifier !== translation.id || !/public domain|creative commons/i.test(parsed.translation?.license ?? '') || !Array.isArray(parsed.verses) || !parsed.verses.length || parsed.verses.length > 200)
            throw new HttpError(502, 'The catalog returned an unexpected chapter payload.');
        for (const v of parsed.verses.sort((a, b) => a.verse - b.verse)) {
            if (v.book_id !== book.bookKey || v.chapter !== chapter)
                throw new HttpError(502, 'The catalog returned mismatched verses.');
            units.push({ citation: `${book.name} ${chapter}:${integer(v.verse, 'Verse', 200)}`, bookKey: book.bookKey, chapter, verse: v.verse, ordinal: units.length + 1, text: requiredString(v.text, 'Verse text', 12000) });
        }
    }
    return json(await importPack(ctx, { packKey: `${translation.id}-${book.bookKey}-${start}-${end}`.toLowerCase(), version: 1, locale: 'en', sourceType: 'Scripture', licensingStatus: 'public-domain', documents: [{ name: book.name, units }] }));
}
