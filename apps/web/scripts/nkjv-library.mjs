/** Offline, server-side NKJV validation and D1 SQL generation. Never contacts a database. */
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import { Buffer } from 'node:buffer';
import { resolve, dirname, join, relative, isAbsolute } from 'node:path';
import process from 'node:process';

export const LIBRARY_ORG = '00000000-0000-4000-8000-000000000066';
export const LIBRARY_ORGANIZATION = Object.freeze({ id: LIBRARY_ORG, name: 'Erudoza Built-in Scripture Library', slug: 'erudoza-builtin-scripture' });
export const SOURCE_PDF_SHA256 = '980b65ec2b6f0961f4e738129a8da88f497f958578c1a47cdddbe20395e13aa9';
const DEFAULT_DIRECTORY = fileURLToPath(new URL('../../../content/nkjv/', import.meta.url));
const BOOK_KEYS = 'GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV'.split(' ');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };

export function stableId(key) {
  const bytes = createHash('sha256').update(`erudoza:nkjv:v1:${key}`, 'utf8').digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

export async function loadLibrary(directory = DEFAULT_DIRECTORY) {
  const root = resolve(directory instanceof URL ? fileURLToPath(directory) : directory);
  const manifestBytes = await readFile(join(root, 'library-manifest.json'));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  requireValue(manifest.schemaVersion === 1 && manifest.translationId === 'nkjv' && manifest.translationName === 'New King James Version' && manifest.version === 1, 'Unsupported NKJV manifest.');
  requireValue(manifest.sourcePdfSha256 === SOURCE_PDF_SHA256, 'The manifest does not identify the approved source PDF.');
  requireValue(Array.isArray(manifest.books) && manifest.books.length === 66, 'The NKJV manifest must contain 66 books.');
  const packs = [], units = [];
  let ordinal = 0, chapterCount = 0;
  for (const [index, book] of manifest.books.entries()) {
    requireValue(book.bookKey === BOOK_KEYS[index] && book.contentPackId === stableId(`book:${book.bookKey}`), `Invalid book identity or order: ${book.bookKey}.`);
    const file = resolve(root, book.file), local = relative(root, file);
    requireValue(!isAbsolute(local) && local !== '..' && !local.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`), 'Book path leaves the server-side library directory.');
    const bytes = await readFile(file);
    requireValue(sha256(bytes) === book.sha256, `SHA-256 mismatch for ${book.bookKey}; refusing modified same-version content.`);
    const pack = JSON.parse(bytes.toString('utf8'));
    requireValue(pack.packKey === `builtin-nkjv-${book.bookKey.toLowerCase()}` && pack.version === 1 && pack.locale === 'en' && pack.sourceType === 'Scripture' && pack.licensingStatus === 'supplied-private', `Invalid source metadata for ${book.bookKey}.`);
    requireValue(pack.documents?.length === 1 && pack.documents[0].name === book.name, `Invalid document for ${book.bookKey}.`);
    const source = pack.documents[0].units;
    requireValue(Array.isArray(source) && source.length === book.verseCount, `Verse count mismatch for ${book.bookKey}.`);
    requireValue(Array.isArray(book.chapters) && book.chapters.length > 0, `Missing chapters for ${book.bookKey}.`);
    const coordinates = [];
    for (const [chapterIndex, chapter] of book.chapters.entries()) {
      requireValue(chapter.number === chapterIndex + 1 && Array.isArray(chapter.verses) && chapter.verses.length > 0, `Invalid chapter structure for ${book.bookKey}.`);
      chapterCount++;
      for (const [verseIndex, verse] of chapter.verses.entries()) {
        requireValue(verse === verseIndex + 1, `Missing or duplicated verse in ${book.bookKey} ${chapter.number}.`);
        coordinates.push([chapter.number, verse]);
      }
    }
    requireValue(coordinates.length === source.length, `Coordinate count mismatch for ${book.bookKey}.`);
    source.forEach((unit, index) => {
      const [chapter, verse] = coordinates[index];
      ordinal++;
      requireValue(unit.bookKey === book.bookKey && unit.chapter === chapter && unit.verse === verse && unit.ordinal === ordinal && unit.citation === `${book.name} ${chapter}:${verse}`, `Invalid verse coordinate or ordinal: ${unit.citation}.`);
      requireValue(typeof unit.text === 'string' && unit.text.trim() === unit.text && unit.text.length > 0 && !Array.from(unit.text).some(character => character.codePointAt(0) < 32 || character.codePointAt(0) === 65533), `Invalid verse text: ${unit.citation}.`);
    });
    packs.push(pack);
    units.push(...source);
  }
  requireValue(ordinal === 31102 && chapterCount === 1189, 'Incomplete NKJV canon.');
  return { manifest, manifestSha256: sha256(manifestBytes), packs, units, root };
}

const quote = value => value === null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
const sqlRow = record => `(${[record.kind, record.id, record.org_id, record.season_id, record.owner_id, JSON.stringify(record.data)].map(quote).join(',')},1)`;
const insertPrefix = 'INSERT INTO Records(kind,id,org_id,season_id,owner_id,data,revision) VALUES\n';
// A conflicting row deliberately violates Records' JSON CHECK. Identical rows are no-ops;
// neither text nor revisions can be silently overwritten by a same-version rerun.
const conflictGuard = `\nON CONFLICT(kind,id,org_id) DO UPDATE SET data='NKJV_LIBRARY_CONFLICT: existing immutable record differs' WHERE Records.data<>excluded.data OR Records.owner_id IS NOT excluded.owner_id OR Records.season_id IS NOT excluded.season_id;`;

/** Shared with the offline .NET-to-D1 exporter so both paths install identical JSON. */
export function libraryRecords(library) {
  const { manifest, manifestSha256, packs } = library;
  requireValue(/^[0-9a-f]{64}$/.test(manifestSha256), 'A SHA-256 of the exact library-manifest.json bytes is required.');
  const records = [];
  const append = (kind, id, owner, data) => records.push({ kind, id, org_id: LIBRARY_ORG, season_id: null, owner_id: owner, data });
  for (const [index, book] of manifest.books.entries()) {
    const pack = packs[index];
    const sourceProvenance = { licensingStatus: 'supplied-private', approvalStatus: 'approved-for-this-app', sourcePdfSha256: manifest.sourcePdfSha256, sourceFileName: 'New-King-James-Version Bible.pdf', importFileSha256: book.sha256 };
    append('pack', book.contentPackId, null, {
      id: book.contentPackId, packKey: pack.packKey, version: 1, locale: 'en', sourceType: 'Scripture', licensingStatus: 'approved',
      unitCount: book.verseCount, isActive: true, isBuiltIn: true, fingerprint: book.sha256,
      bookKey: book.bookKey, bookName: book.name, bookOrdinal: index + 1, chapters: book.chapters, sourceProvenance,
    });
    for (const unit of pack.documents[0].units) {
      const id = stableId(`verse:${book.bookKey}:${unit.chapter}:${unit.verse}`);
      append('source', id, book.contentPackId, {
        id, contentPackId: book.contentPackId, contentDocumentId: stableId(`document:${book.bookKey}`), knowledgeUnitId: id,
        citation: unit.citation, bookKey: unit.bookKey, chapter: unit.chapter, verse: unit.verse, ordinal: unit.ordinal,
        canonicalText: unit.text, textSha256: sha256(unit.text), isActive: true, isRetired: false,
      });
    }
  }
  append('library-version', 'nkjv-v1', null, { translationId: manifest.translationId, translationName: manifest.translationName, version: 1, bookCount: 66, chapterCount: 1189, verseCount: 31102, ready: true, sourcePdfSha256: manifest.sourcePdfSha256, manifestSha256 });
  return records;
}

export function seedStatements(library) {
  const records = libraryRecords(library), organization = LIBRARY_ORGANIZATION;
  const statements = [
    `INSERT INTO Organizations(id,name,slug) VALUES(${quote(organization.id)},${quote(organization.name)},${quote(organization.slug)}) ON CONFLICT(id) DO UPDATE SET name=NULL WHERE Organizations.name<>${quote(organization.name)} OR Organizations.slug<>${quote(organization.slug)};`,
  ];
  let rows = [], bytes = 0;
  const flush = () => { if (rows.length) statements.push(insertPrefix + rows.join(',\n') + conflictGuard); rows = []; bytes = 0; };
  for (const record of records.slice(0, -1)) {
    const value = sqlRow(record), size = Buffer.byteLength(value, 'utf8');
    if (bytes + size > 60000) flush();
    rows.push(value); bytes += size + 2;
  }
  flush();
  // The ready record is the last statement and is rejected if extra/missing library rows exist.
  const version = records.at(-1), complete = `(SELECT count(*) FROM Records WHERE org_id=${quote(LIBRARY_ORG)} AND kind='pack')=66 AND (SELECT count(*) FROM Records WHERE org_id=${quote(LIBRARY_ORG)} AND kind='source')=31102`;
  statements.push(`INSERT INTO Records(kind,id,org_id,season_id,owner_id,data,revision) VALUES('library-version','nkjv-v1',${quote(LIBRARY_ORG)},NULL,NULL,CASE WHEN ${complete} THEN ${quote(JSON.stringify(version.data))} ELSE 'NKJV_LIBRARY_INCOMPLETE' END,1)${conflictGuard}`);
  return statements;
}

async function main() {
  const args = process.argv.slice(2);
  requireValue(args.length <= 1 && (!args[0] || ['--validate', '--write-sql'].includes(args[0])), 'Usage: node apps/web/scripts/nkjv-library.mjs [--validate|--write-sql]');
  const library = await loadLibrary();
  const result = { status: 'valid', books: 66, chapters: 1189, verses: 31102, sourcePdfSha256: library.manifest.sourcePdfSha256, manifestSha256: library.manifestSha256 };
  if (args[0] === '--write-sql') {
    const statements = seedStatements(library), output = join(library.root, 'generated', 'nkjv-v1.sql');
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, '-- Generated locally from the user-supplied NKJV. Server-side provisioning only.\n' + statements.join('\n') + '\n', 'utf8');
    Object.assign(result, { sqlFile: output, statements: statements.length, sqlSha256: sha256(await readFile(output)), databaseContacted: false });
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
}
