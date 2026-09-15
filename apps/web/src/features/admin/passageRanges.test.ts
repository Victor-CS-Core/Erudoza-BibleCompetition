import { describe, expect, it } from "vitest";
import { formatPassageCitation } from "./passageRanges";

describe("formatPassageCitation", () => {
  it("cites single verses, spans, and cross-chapter ranges", () => {
    expect(formatPassageCitation({ bookKey: "John", startChapter: 3, startVerse: 16, endChapter: 3, endVerse: 16 })).toBe("John 3:16");
    expect(formatPassageCitation({ bookKey: "John", startChapter: 3, startVerse: 16, endChapter: 3, endVerse: 18 })).toBe("John 3:16–18");
    expect(formatPassageCitation({ bookKey: "John", startChapter: 3, startVerse: 16, endChapter: 4, endVerse: 3 })).toBe("John 3:16–4:3");
  });
});
