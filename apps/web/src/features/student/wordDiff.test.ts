import { describe, expect, it } from "vitest";
import { diffWords, editDistance, isSpellingPair } from "./wordDiff";

const statuses = (tokens: { status: string }[]) => tokens.map(t => t.status);

describe("wordDiff", () => {
  it("marks an exact match as all match, ignoring case and punctuation", () => {
    const diff = diffWords("Went out to him, and were baptized.", "went out to him and were baptized");
    expect(statuses(diff.expected)).toEqual(diff.expected.map(() => "match"));
    expect(statuses(diff.submitted)).toEqual(diff.submitted.map(() => "match"));
    expect(diff.missed).toBe(0); expect(diff.extra).toBe(0); expect(diff.spelling).toBe(0);
  });

  it("highlights a missed word without cascading (Mark 1:5 'out')", () => {
    const expected = "Then all the land of Judea, and those from Jerusalem, went out to him and were all baptized by him in the Jordan River, confessing their sins.";
    const submitted = "Then all the land of Judea, and those from Jerusalem, went to him and were all baptized by him in the Jordan River, confessing their sins.";
    const diff = diffWords(expected, submitted);
    expect(diff.missed).toBe(1); expect(diff.extra).toBe(0); expect(diff.spelling).toBe(0);
    expect(diff.expected.find(t => t.status === "missed")?.text).toBe("out");
    // Words after the gap still align as matches.
    expect(diff.expected.at(-1)?.status).toBe("match");
    expect(diff.submitted.every(t => t.status === "match")).toBe(true);
  });

  it("highlights extra words the student added", () => {
    const diff = diffWords("went out to him", "went out quickly to him");
    expect(diff.extra).toBe(1); expect(diff.missed).toBe(0);
    expect(diff.submitted.find(t => t.status === "extra")?.text).toBe("quickly");
  });

  it("classifies a clear misspelling as spelling, not missed+extra", () => {
    const diff = diffWords("and were all baptized by him", "and were all baptised by him");
    expect(diff.spelling).toBe(1); expect(diff.missed).toBe(0); expect(diff.extra).toBe(0);
    expect(diff.spellingPairs).toEqual([{ expected: "baptized", submitted: "baptised" }]);
    expect(diff.expected.find(t => t.text === "baptized")?.status).toBe("spelling");
    expect(diff.submitted.find(t => t.text === "baptised")?.status).toBe("spelling");
  });

  it("classifies a transposition as spelling", () => {
    expect(isSpellingPair("receive", "recieve")).toBe(true);
    const diff = diffWords("you will receive power", "you will recieve power");
    expect(diff.spelling).toBe(1);
  });

  it("does NOT classify a genuinely different word as spelling", () => {
    expect(isSpellingPair("walked", "went")).toBe(false);
    expect(isSpellingPair("river", "mountain")).toBe(false);
    const diff = diffWords("he walked to the river", "he went to the river");
    expect(diff.spelling).toBe(0);
    expect(diff.expected.find(t => t.text === "walked")?.status).toBe("missed");
    expect(diff.submitted.find(t => t.text === "went")?.status).toBe("extra");
  });

  it("keeps extra trailing words extra and missing trailing words missed", () => {
    const diff = diffWords("in the beginning god created", "in the beginning god made the heavens");
    expect(diff.expected.filter(t => t.status === "missed").map(t => t.text)).toEqual(["created"]);
    expect(diff.submitted.filter(t => t.status === "extra").map(t => t.text)).toEqual(["made", "the", "heavens"]);
  });

  it("does not blame the student for spelling when the answer was spoken (markSpelling off)", () => {
    const diff = diffWords("and were all baptized by him", "and were all baptised by him", { markSpelling: false });
    expect(diff.spelling).toBe(0);
    expect(diff.expected.find(t => t.text === "baptized")?.status).toBe("missed");
    expect(diff.submitted.find(t => t.text === "baptised")?.status).toBe("extra");
  });

  it("editDistance counts substitutions, insertions, deletions and transpositions", () => {
    expect(editDistance("abc", "abc")).toBe(0);
    expect(editDistance("abc", "abd")).toBe(1);
    expect(editDistance("abc", "ab")).toBe(1);
    expect(editDistance("abc", "abcd")).toBe(1);
    expect(editDistance("ab", "ba")).toBe(1);
    expect(editDistance("kitten", "sitting")).toBe(3);
  });
});
