import { describe, expect, it } from "vitest";
import { parseContentPackImport, sampleJoshuaPackJson } from "../features/admin/contentPackImport";

describe("parseContentPackImport", () => {
  it("parses a versioned synthetic pack", () => {
    const pack = parseContentPackImport(sampleJoshuaPackJson());
    expect(pack.packKey).toBe("dev-joshua");
    expect(pack.version).toBe(1);
    expect(pack.sourceType).toBe("Scripture");
    expect(pack.documents[0]?.units).toHaveLength(3);
    expect(pack.documents[0]?.units[0]?.text).toContain("Joshua rose early");
  });

  it("rejects empty or invalid JSON", () => {
    expect(() => parseContentPackImport("")).toThrow(/valid JSON/i);
    expect(() => parseContentPackImport("{")).toThrow(/valid JSON/i);
  });

  it("rejects a pack with no stored verses", () => {
    expect(() =>
      parseContentPackImport(
        JSON.stringify({
          packKey: "empty",
          version: 1,
          locale: "en",
          sourceType: "Scripture",
          documents: [{ name: "Empty", units: [] }],
        }),
      ),
    ).toThrow(/at least one verse/i);
  });
});
