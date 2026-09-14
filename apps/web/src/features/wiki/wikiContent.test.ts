import { describe, expect, it } from "vitest";
import { navigation } from "../../components/navigation/destinations";
import { searchWiki, wikiArticles } from "./wikiContent";

const allDestinations = [
  ...navigation(false),
  ...navigation(false, null, true),
  ...navigation(true),
  ...navigation(true, null, true),
].flatMap(item => [item, ...(item.children ?? [])]);

describe("wiki content", () => {
  it("documents every navigable student and coach destination", () => {
    const covered = new Set(wikiArticles.flatMap(article => article.featureIds));
    const missing = allDestinations.map(item => item.id).filter(id => !covered.has(id));

    expect(missing).toEqual([]);
  });

  it("keeps article identifiers unique and searchable detail-rich content", () => {
    expect(new Set(wikiArticles.map(article => article.id)).size).toBe(wikiArticles.length);
    expect(wikiArticles.length).toBeGreaterThanOrEqual(20);
    expect(searchWiki(wikiArticles, "save assignments retry").map(result => result.article.id)).toContain("assignments");
    expect(searchWiki(wikiArticles, "credential verification").map(result => result.article.id)).toContain("account-access");
  });

  it("exposes the wiki in both workspace navigation modes", () => {
    expect(navigation(false).find(item => item.id === "wiki")).toMatchObject({ label: "Wiki / Help", to: "/wiki" });
    expect(navigation(true).find(item => item.id === "wiki")).toMatchObject({ label: "Wiki / Help", to: "/wiki" });
  });
});
