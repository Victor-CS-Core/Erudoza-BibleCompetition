// @vitest-environment node
// CROSS-WIRE CONTRACT suite for the PBE news surface (card 15; pattern from
// capture-control-center.test.ts + control-center-contract.test.ts). Boots
// the real native app, seeds published + draft articles under the library
// org through the real record shape, reads the learner feed and one article
// over HTTP, then (a) pins both payloads to the CLIENT contract
// (src/api/types.ts PbeNewsArticleSummary / PbeNewsArticle) and (b) saves
// the exact server-emitted payloads as fixtures for
// src/features/news/news-real.test.tsx. A routine run COMPARES against the
// checked-in fixture and fails on drift (card 28); regenerate only after
// an intentional contract change:
//   UPDATE_FIXTURES=1 npx vitest run worker/native/capture-news.test.ts
// A hand-edited fixture is no evidence at all — regenerate, never patch.
import { afterAll, beforeAll, expect, it } from "vitest";
import { createNativeTestApp, persistCaptureFixture, TEST_ORG, TEST_USER } from "./test-runtime";
import { LIBRARY_ORG } from "./application/library-access";
import type { PbeNewsArticle, PbeNewsArticleSummary } from "../../src/api/types";

let app: Awaited<ReturnType<typeof createNativeTestApp>>;
let cookie = "";

async function record(kind: string, id: string, org: string, value: unknown) {
  await app.db.prepare("INSERT INTO Records(kind,id,org_id,season_id,owner_id,data) VALUES(?,?,?,?,?,?)").bind(kind, id, org, null, null, JSON.stringify(value)).run();
}
async function request<T>(path: string): Promise<{ status: number; body: T }> {
  const res = await app.fetch(path, { headers: { Cookie: cookie, Origin: "https://erudoza.test" } });
  return { status: res.status, body: await res.json() as T };
}
function expectKeys(obj: Record<string, unknown>, required: string[], context: string) {
  for (const key of required) expect(obj, `${context} missing ${key}`).toHaveProperty(key);
}

const ARTICLE_1 = {
  id: "news-capture-1", title: "New PBE materials detected", summary: "NAD posted a new Commentary PDF for the 2026–27 competition year.",
  sections: [{ heading: "What changed", body: "The commentary file was replaced on the resources page." }],
  status: "published", createdBy: "nad-watcher", createdAtUtc: "2026-11-18T00:00:00Z", updatedAtUtc: "2026-11-19T00:00:00Z",
  publishedAtUtc: "2026-11-19T12:00:00Z", publishedBy: "coach", articleType: "study-material",
  keyPoints: ["New commentary PDF"], linkedMaterials: [{ label: "PBE resources", href: "https://nadpbe.org/pbe-resources/" }],
  readMinutes: 2, sourceUrl: "https://nadpbe.org/wp-content/uploads/x.pdf", sourceLabel: "nadpbe.org",
};
const ARTICLE_2 = {
  id: "news-capture-2", title: "Event update", summary: "Division finals moved to April.",
  sections: [{ heading: "Details", body: "The finals venue is unchanged." }],
  status: "published", createdBy: "coach", createdAtUtc: "2026-11-10T00:00:00Z", updatedAtUtc: "2026-11-10T00:00:00Z",
  publishedAtUtc: "2026-11-10T12:00:00Z",
};
const DRAFT = { ...ARTICLE_2, id: "news-capture-draft", title: "Unpublished draft", status: "draft", publishedAtUtc: undefined };

beforeAll(async () => {
  app = await createNativeTestApp();
  await app.db.prepare("UPDATE Users SET kind='Student',role='Student' WHERE id=?").bind(TEST_USER).run();
  cookie = (await app.login()).headers.get("set-cookie")!.split(";")[0];
  await app.db.prepare("INSERT INTO Organizations(id, name, slug) VALUES(?,?,?)").bind(LIBRARY_ORG, "Immutable Scripture Library", "scripture-library").run();
  await record("pbe-news-article", ARTICLE_1.id, LIBRARY_ORG, ARTICLE_1);
  await record("pbe-news-article", ARTICLE_2.id, LIBRARY_ORG, ARTICLE_2);
  await record("pbe-news-article", DRAFT.id, LIBRARY_ORG, DRAFT);
}, 60000);
afterAll(async () => { await app?.runtime.dispose(); });

it("captures real news payloads and pins them to the client contract", async () => {
  const feed = await request<PbeNewsArticleSummary[]>(`/api/v1/organizations/${TEST_ORG}/pbe-news`);
  expect(feed.status).toBe(200);
  // PbeNewsArticleSummary[]: published only, newest first; drafts never leak.
  expect(Array.isArray(feed.body)).toBe(true);
  expect(feed.body.map(a => a.id)).toEqual(["news-capture-1", "news-capture-2"]);
  for (const item of feed.body) {
    expectKeys(item, ["id", "title", "summary", "publishedAtUtc", "articleType", "keyPoints", "linkedMaterials", "readMinutes", "sourceUrl", "sourceLabel"], "news feed[]");
  }
  const first = feed.body[0]!;
  expect(first.title).toBe("New PBE materials detected");
  expect(first.articleType).toBe("study-material");
  expect(first.sourceLabel).toBe("nadpbe.org");
  // Legacy article without optional fields: the server backfills articleType
  // and emits nulls the client renders as "no chip / no read time".
  const second = feed.body[1]!;
  expect(second.articleType).toBe("announcement");
  expect(second.sourceUrl).toBeNull();
  expect(second.readMinutes).toBeNull();

  const article = await request<PbeNewsArticle>(`/api/v1/organizations/${TEST_ORG}/pbe-news/news-capture-1`);
  expect(article.status).toBe(200);
  // PbeNewsArticle: the full record the article page renders.
  expectKeys(article.body, ["id", "title", "summary", "sections", "status", "createdBy", "createdAtUtc", "updatedAtUtc", "publishedAtUtc", "articleType", "keyPoints", "linkedMaterials"], "news article");
  for (const section of article.body.sections) expectKeys(section, ["heading", "body"], "news article sections[]");
  expect(article.body.sections[0]!.heading).toBe("What changed");
  expect(article.body.status).toBe("published");

  // The draft is not readable through the learner detail route either.
  const draft = await app.fetch(`/api/v1/organizations/${TEST_ORG}/pbe-news/news-capture-draft`, { headers: { Cookie: cookie, Origin: "https://erudoza.test" } });
  expect(draft.status).toBe(404);

  const out = {
    feed: { status: feed.status, body: feed.body },
    article: { status: article.status, body: article.body },
  };
  persistCaptureFixture(new URL("../../src/features/news/__fixtures__/news-payloads.json", import.meta.url), JSON.stringify(out, null, 2));
}, 60000);
