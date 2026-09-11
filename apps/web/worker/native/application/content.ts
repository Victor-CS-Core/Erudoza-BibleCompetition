import type { RequestContext } from '../types';
import { HttpError, json, noContent, requiredString } from '../types';
import { sha256 } from '../auth';
import { atomic, fail, id, integer } from './model';
import type { Pack, Source } from './model';
const MAX_IMPORT_UNITS = 5000;
const MAX_SOURCE_INSERT_BYTES = 1_800_000;
// Known catalog keys carry edition identity that generic custom names do not.
const catalogEdition = (key: string) => key.toLowerCase().match(/^(web|kjv|asv|bbe|webbe|oeb-us)-[a-z0-9]{3,4}-[1-9]\d*-[1-9]\d*$/)?.[1] ?? null;
interface ImportUnit {
    citation: string;
    bookKey: string;
    chapter: number;
    verse: number;
    ordinal: number;
    text: string;
}
interface ImportRequest {
    packKey: string;
    version: number;
    locale: string;
    sourceType: string;
    licensingStatus?: string;
    documents: {
        name: string;
        units: ImportUnit[];
    }[];
}
export async function importPack(ctx: RequestContext, input: ImportRequest): Promise<Pack> {
    if (!input || typeof input !== 'object')
        return fail('Invalid content pack.');
    const packKey = requiredString(input.packKey, 'Pack key', 160), version = integer(input.version, 'Version'), locale = requiredString(input.locale, 'Locale', 20);
    const sourceType = ['Scripture', 'Supplemental'].find(t => t.toLowerCase() === String(input.sourceType).toLowerCase());
    if (!sourceType)
        return fail('Invalid source type.');
    if (!Array.isArray(input.documents) || !input.documents.length || input.documents.length > 66)
        return fail('Import between 1 and 66 documents.');
    const units: ImportUnit[] = [], locators = new Set<string>(), ordinals = new Set<number>();
    for (const doc of input.documents) {
        requiredString(doc?.name, 'Document name');
        if (!Array.isArray(doc.units) || !doc.units.length)
            return fail('Every document needs source units.');
        for (const u of doc.units) {
            if (!u || typeof u !== 'object')
                return fail('Invalid source unit.');
            const unit = { citation: requiredString(u.citation, 'Citation', 200), bookKey: requiredString(u.bookKey, 'Book', 20).toUpperCase(), chapter: integer(u.chapter, 'Chapter', 200), verse: integer(u.verse, 'Verse', 1000), ordinal: integer(u.ordinal, 'Ordinal'), text: requiredString(u.text, 'Source text', 12000) };
            const locator = `${unit.bookKey}:${unit.chapter}:${unit.verse}`;
            if (locators.has(locator) || ordinals.has(unit.ordinal))
                return fail('Duplicate source locator or ordinal.');
            locators.add(locator);
            ordinals.add(unit.ordinal);
            units.push(unit);
            if (units.length > MAX_IMPORT_UNITS)
                return fail(`Import at most ${MAX_IMPORT_UNITS} source units at a time.`);
        }
    }
    units.sort((a, b) => a.ordinal - b.ordinal);
    const licensingStatus = input.licensingStatus ? requiredString(input.licensingStatus, 'Licensing status', 100) : 'development-sample';
    const metadata = { version, locale: locale.toLowerCase(), sourceType: sourceType.toLowerCase(), licensingStatus: licensingStatus.toLowerCase(), catalogEdition: catalogEdition(packKey) };
    const fingerprint = await sha256(JSON.stringify(units.map(u => ({ bookKey: u.bookKey, chapter: u.chapter, verse: u.verse, ordinal: u.ordinal, text: u.text }))));
    const sameMetadata = (p: Pack) => p.version === version && p.locale.trim().toLowerCase() === metadata.locale
        && p.sourceType.toLowerCase() === metadata.sourceType && p.licensingStatus.trim().toLowerCase() === metadata.licensingStatus
        && catalogEdition(p.packKey) === metadata.catalogEdition;
    const unavailable = () => fail('A matching content pack is inactive or has unavailable sources. Import a new version.');
    const contentState = async (p: Pack): Promise<'different' | 'available' | 'unavailable'> => {
        if (!sameMetadata(p) || p.unitCount !== units.length || p.fingerprint && p.fingerprint !== fingerprint)
            return 'different';
        const saved = await ctx.store.list<Source>('source', ctx.orgId, { ownerId: p.id });
        const oldFingerprint = p.fingerprint ?? await sha256(JSON.stringify(saved.sort((a, b) => a.ordinal - b.ordinal).map(s => ({ bookKey: s.bookKey.trim().toUpperCase(), chapter: s.chapter, verse: s.verse, ordinal: s.ordinal, text: s.canonicalText }))));
        if (oldFingerprint !== fingerprint)
            return 'different';
        return p.isActive && saved.length === units.length && saved.every(s => s.isActive && !s.isRetired) ? 'available' : 'unavailable';
    };
    const packs = await ctx.store.list<Pack>('pack', ctx.orgId);
    const named = packs.find(p => p.packKey === packKey && p.version === version);
    if (named) {
        const state = await contentState(named);
        if (state === 'unavailable')
            return unavailable();
        if (state !== 'available')
            return fail('A changed content pack requires a new version.');
        return named;
    }
    // Names do not create another copy of the same approved source selection.
    // This also preserves IDs for matching packs imported before content identities existed.
    let unavailableMatch = false;
    for (const existing of packs) {
        const state = await contentState(existing);
        if (state === 'available')
            return existing;
        if (state === 'unavailable')
            unavailableMatch = true;
    }
    if (unavailableMatch)
        return unavailable();
    const identity = JSON.stringify({ ...metadata, fingerprint });
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${ctx.orgId}\n${identity}`)));
    digest[6] = (digest[6] & 15) | 80;
    digest[8] = (digest[8] & 63) | 128;
    const hex = [...digest.slice(0, 16)].map(n => n.toString(16).padStart(2, '0')).join('');
    const packId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    const pack: Pack = { id: packId, packKey, version, locale, sourceType, licensingStatus, unitCount: units.length, isActive: true, fingerprint };
    // Preserve named-version uniqueness even when concurrent requests have different content identities.
    const statements = [ctx.env.DB.prepare("INSERT INTO Records(kind,id,org_id,data,revision) VALUES('pack',?,?,CASE WHEN EXISTS(SELECT 1 FROM Records WHERE kind='pack' AND org_id=? AND json_extract(data,'$.packKey')=? AND json_extract(data,'$.version')=? AND id<>?) THEN 'invalid-json' ELSE ? END,1)")
        .bind(pack.id, ctx.orgId, ctx.orgId, packKey, version, pack.id, JSON.stringify(pack))];
    const sources: Source[] = units.map(u => { const sourceId = id(); return { id: sourceId, knowledgeUnitId: sourceId, contentPackId: pack.id, citation: u.citation, bookKey: u.bookKey, chapter: u.chapter, verse: u.verse, ordinal: u.ordinal, canonicalText: u.text, isActive: true }; });
    // Keep each bound JSON string below D1's 2,000,000-byte limit. All chunks
    // remain in the same atomic transaction, including the pack and audit.
    const encoder = new TextEncoder();
    let chunk: string[] = [], chunkBytes = 2;
    const appendChunk = () => {
        statements.push(ctx.env.DB.prepare("INSERT INTO Records(kind,id,org_id,owner_id,data) SELECT 'source',json_extract(value,'$.id'),?,?,value FROM json_each(?)").bind(ctx.orgId, pack.id, `[${chunk.join(',')}]`));
        chunk = [];
        chunkBytes = 2;
    };
    for (const source of sources) {
        const serialized = JSON.stringify(source), bytes = encoder.encode(serialized).byteLength;
        if (chunk.length && chunkBytes + bytes + 1 > MAX_SOURCE_INSERT_BYTES)
            appendChunk();
        chunkBytes += bytes + (chunk.length ? 1 : 0);
        chunk.push(serialized);
    }
    if (chunk.length)
        appendChunk();
    try {
        await atomic(ctx, 'content.import', statements);
    } catch (error) {
        // A competing coach may have committed this exact identity after the lookup.
        // Return only a proven equivalent winner; unrelated database errors still fail.
        if (String(error).includes('UNIQUE constraint failed: Records.kind, Records.id, Records.org_id')) {
            const winner = await ctx.store.get<Pack>('pack', pack.id, ctx.orgId);
            const state = winner ? await contentState(winner.value) : 'different';
            if (winner && state === 'available')
                return winner.value;
            if (state === 'unavailable')
                return unavailable();
        }
        if (error instanceof HttpError && error.status === 409 && error.message === 'The record changed. Refresh and retry.') {
            const winner = (await ctx.store.list<Pack>('pack', ctx.orgId)).find(p => p.packKey === packKey && p.version === version);
            if (winner) {
                const state = await contentState(winner);
                if (state === 'available')
                    return winner;
                if (state === 'unavailable')
                    return unavailable();
                return fail('A changed content pack requires a new version.');
            }
        }
        throw error;
    }
    return pack;
}
export async function content(ctx: RequestContext): Promise<Response | null> {
    const { path, request, orgId, store } = ctx;
    if (path === '/content-packs' && request.method === 'GET')
        return json(await store.list<Pack>('pack', orgId));
    if (path === '/content-packs/import' && request.method === 'POST')
        throw new HttpError(410, 'Manual imports have been retired. Choose books from the built-in NKJV library.');
    const match = path.match(/^\/content-packs\/([^/]+)(\/source-units)?$/);
    if (!match)
        return null;
    const pack = await store.require<Pack>('pack', match[1], orgId);
    if (match[2] && request.method === 'GET')
        return json((await store.list<Source>('source', orgId, { ownerId: pack.value.id })).sort((a, b) => a.ordinal - b.ordinal));
    if (!match[2] && request.method === 'DELETE') {
        if (pack.value.isBuiltIn) throw new HttpError(403, 'The built-in library is read-only.');
        // All dependent records are checked by SQL in the mutation transaction, avoiding a check/delete race.
        const protectedSql = `SELECT 1 FROM Records r WHERE r.org_id=? AND ( (r.kind IN ('scope','assignment') AND EXISTS(SELECT 1 FROM json_tree(r.data) jt WHERE jt.key='contentPackId' AND jt.value=?)) OR (r.kind IN ('card','mastery','attempt','review','session') AND (json_extract(r.data,'$.contentPackId')=? OR json_extract(r.data,'$.sourceUnitId') IN (SELECT id FROM Records WHERE kind='source' AND org_id=? AND owner_id=?) OR json_extract(r.data,'$.knowledgeUnitId') IN (SELECT id FROM Records WHERE kind='source' AND org_id=? AND owner_id=?) OR EXISTS(SELECT 1 FROM json_tree(r.data) jt WHERE jt.key IN ('sourceUnitId','answerSourceUnitId','knowledgeUnitId','contentPackId') AND (jt.value=? OR jt.value IN (SELECT id FROM Records WHERE kind='source' AND org_id=? AND owner_id=?))))))`;
        const args = [orgId, pack.value.id, pack.value.id, orgId, pack.value.id, orgId, pack.value.id, pack.value.id, orgId, pack.value.id];
        if (await ctx.env.DB.prepare(protectedSql).bind(...args).first())
            throw new HttpError(409, 'This pack is used by a season, assignment, or study history and cannot be deleted.');
        const guard = ctx.env.DB.prepare(`INSERT INTO Records(kind,id,org_id,data) SELECT 'audit',?, ?, CASE WHEN EXISTS(${protectedSql}) THEN 'invalid-json' ELSE '{}' END`).bind(id(), orgId, ...args);
        await atomic(ctx, 'content.delete', [guard, ctx.env.DB.prepare("DELETE FROM Records WHERE org_id=? AND ((kind='source' AND owner_id=?) OR (kind='pack' AND id=?))").bind(orgId, pack.value.id, pack.value.id)], [{ kind: 'pack', id: pack.value.id, revision: pack.revision }]);
        return noContent();
    }
    return null;
}
