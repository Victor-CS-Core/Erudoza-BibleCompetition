// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestContext } from "../types";

const { importPack } = vi.hoisted(() => ({ importPack: vi.fn() }));
vi.mock("./content", () => ({ importPack }));
let catalog: typeof import("./catalog").catalog;
const fetchMock = vi.fn<typeof fetch>();
const dbAccess = vi.fn(() => { throw new Error("Catalog validation must not access stored content"); });
function context(path: string, input?: unknown): RequestContext {
  const url = `https://erudoza.test/api/v1/organizations/org${path}`;
  return {
    path: path.split("?")[0], orgId: "org",
    request: new Request(url, input === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }),
    actor: { userId: "coach", organizationId: "org", organizationName: "Erudoza Academy", displayName: "Coach", userName: "coach", email: null, kind: "Adult", role: "Admin", credentialVersion: "1" },
    env: { DB: { prepare: dbAccess } } as unknown as RequestContext["env"],
    store: { list: dbAccess, insertion: dbAccess, get: dbAccess } as unknown as RequestContext["store"],
  };
}
function importRequest(overrides: Record<string, unknown> = {}) {
  return context("/content-packs/import-from-catalog", { translationId: "web", bookKey: "JUD", startChapter: 1, endChapter: 1, ...overrides });
}
function booksResponse() { return Response.json({ books: [{ id: "JUD", name: "Jude" }, { id: "GEN", name: "Genesis" }] }); }
function expectNoImport() { expect(importPack).not.toHaveBeenCalled(); expect(dbAccess).not.toHaveBeenCalled(); }
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); vi.stubGlobal("fetch", fetchMock);
  ({ catalog } = await import("./catalog"));
});
afterEach(() => vi.unstubAllGlobals());

describe("Scripture catalog metadata and import boundaries", () => {
  it("returns the provider's available books rather than the static complete Bible list", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ books: [{ id: "MAT", name: "Matthew" }] }));
    const response = await catalog(context("/scripture-catalog/books?translationId=oeb-us"));
    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual([{ bookKey: "MAT", name: "Matthew" }]);
    expect(fetchMock).toHaveBeenCalledWith("https://bible-api.com/data/oeb-us", expect.objectContaining({ redirect: "error" }));
    expectNoImport();
  });
  it.each([null, { books: [null] }, { books: [{ id: "JUD", name: " " }] }, { books: [{ id: 123, name: "Jude" }] }])("rejects malformed book metadata without caching it: %j", async payload => {
    fetchMock.mockResolvedValueOnce(Response.json(payload)).mockResolvedValueOnce(booksResponse());
    await expect(catalog(context("/scripture-catalog/books?translationId=web"))).rejects.toMatchObject({ status: 502, message: "The catalog returned unreadable book information." });
    const recovered = await catalog(context("/scripture-catalog/books?translationId=web"));
    expect((await recovered?.json())).toContainEqual({ bookKey: "JUD", name: "Jude" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expectNoImport();
  });
  it.each([null, { chapters: [null] }])("rejects malformed chapter metadata without caching it: %j", async payload => {
    fetchMock.mockResolvedValueOnce(booksResponse()).mockResolvedValueOnce(Response.json(payload)).mockResolvedValueOnce(Response.json({ chapters: [{ book_id: "JUD", chapter: 1 }] }));
    await expect(catalog(context("/scripture-catalog/books/JUD/chapters?translationId=web"))).rejects.toMatchObject({ status: 502, message: "The catalog returned unreadable chapter information." });
    const recovered = await catalog(context("/scripture-catalog/books/JUD/chapters?translationId=web"));
    expect(await recovered?.json()).toEqual({ chapters: [1], maxChaptersPerImport: 8 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expectNoImport();
  });
  it("returns sorted unique available chapters with the import limit", async () => {
    fetchMock.mockResolvedValueOnce(booksResponse()).mockResolvedValueOnce(Response.json({ chapters: [
      { book_id: "GEN", chapter: 3 }, { book_id: "GEN", chapter: 1 }, { book_id: "GEN", chapter: 3 },
    ] }));
    const response = await catalog(context("/scripture-catalog/books/gen/chapters?translationId=web"));
    expect(await response?.json()).toEqual({ chapters: [1, 3], maxChaptersPerImport: 8 });
    expect(fetchMock).toHaveBeenLastCalledWith("https://bible-api.com/data/web/GEN", expect.anything());
    expectNoImport();
  });
  it("rejects chapter two of a single-chapter book before requesting verses", async () => {
    fetchMock.mockResolvedValueOnce(booksResponse()).mockResolvedValueOnce(Response.json({ chapters: [{ book_id: "JUD", chapter: 1 }] }));
    await expect(catalog(importRequest({ startChapter: 2, endChapter: 2 }))).rejects.toMatchObject({ status: 400, message: "Choose chapters available in Jude for this translation." });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["https://bible-api.com/data/web", "https://bible-api.com/data/web/JUD"]);
    expectNoImport();
  });
  it("rejects a book missing from the selected translation before requesting chapters", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ books: [{ id: "MAT", name: "Matthew" }] }));
    await expect(catalog(importRequest({ translationId: "oeb-us", bookKey: "GEN" }))).rejects.toMatchObject({ status: 400, message: "Choose a book available in the selected translation." });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expectNoImport();
  });
  it("rejects batches longer than eight chapters before requesting chapters or verses", async () => {
    fetchMock.mockResolvedValueOnce(booksResponse());
    await expect(catalog(importRequest({ bookKey: "GEN", startChapter: 1, endChapter: 9 }))).rejects.toMatchObject({ status: 400, message: "Import 1 to 8 consecutive chapters." });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expectNoImport();
  });
  it("rejects missing chapters within a requested range, not just its endpoints", async () => {
    fetchMock.mockResolvedValueOnce(booksResponse()).mockResolvedValueOnce(Response.json({ chapters: [{ book_id: "GEN", chapter: 1 }, { book_id: "GEN", chapter: 3 }] }));
    await expect(catalog(importRequest({ bookKey: "GEN", startChapter: 1, endChapter: 3 }))).rejects.toMatchObject({ status: 400, message: "Choose chapters available in Genesis for this translation." });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expectNoImport();
  });
  it("reports a provider outage as a recoverable gateway failure", async () => {
    fetchMock.mockResolvedValueOnce(new Response("Temporarily unavailable", { status: 503 }));
    await expect(catalog(context("/scripture-catalog/books?translationId=web"))).rejects.toMatchObject({ status: 502, message: "Available books or chapters could not load. Try again in a moment." });
    expectNoImport();
  });
  it("reports network failures with an actionable catalog message", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(catalog(importRequest())).rejects.toMatchObject({ status: 502, message: "The Scripture catalog is unavailable. Try again in a moment." });
    expectNoImport();
  });
  it("rejects malformed chapter metadata without importing content", async () => {
    fetchMock.mockResolvedValueOnce(booksResponse()).mockResolvedValueOnce(Response.json({ chapters: [{ book_id: "GEN", chapter: 1 }] }));
    await expect(catalog(importRequest())).rejects.toMatchObject({ status: 502, message: "The catalog returned unreadable chapter information." });
    expectNoImport();
  });
});
