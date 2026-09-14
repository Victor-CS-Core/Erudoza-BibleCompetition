import { describe, expect, it } from "vitest";
import { navigation } from "../../components/navigation/destinations";
import { appWikiGroups, publicWikiGroups, searchWiki, wikiArticles, wikiArticlesByScope } from "./wikiContent";

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

  it("exposes in-app help in coach navigation and the public wiki in the shared footer", () => {
    expect(navigation(true).find(item => item.id === "wiki")).toMatchObject({ label: "Help", to: "/help" });
    // Students reach help from the footer (next to Privacy/Terms), not the five-item nav.
    expect(navigation(false).some(item => item.id === "wiki")).toBe(false);
  });

  it("splits articles into public wiki and in-app help scopes", () => {
    const scopes = new Set(wikiArticles.map(article => article.scope));
    expect(scopes).toEqual(new Set(["public", "app"]));
    expect(wikiArticlesByScope("public").every(article => article.scope === "public")).toBe(true);
    expect(wikiArticlesByScope("app").every(article => article.scope === "app")).toBe(true);
    // The search guide exists in both scopes with scope-correct links.
    expect(wikiArticlesByScope("public").find(article => article.id === "wiki-search")?.links?.[0].to).toBe("/wiki");
    expect(wikiArticlesByScope("app").find(article => article.id === "help-search")?.links?.[0].to).toBe("/help");
  });

  it("keeps each scope's groups pointed at in-scope articles", () => {
    for (const [scope, groups] of [["public", publicWikiGroups], ["app", appWikiGroups]] as const) {
      const ids = new Set(wikiArticlesByScope(scope).map(article => article.id));
      const grouped = groups.flatMap(group => group.articleIds);
      expect(grouped.every(id => ids.has(id))).toBe(true);
      expect(new Set(grouped).size).toBe(grouped.length);
    }
  });
});