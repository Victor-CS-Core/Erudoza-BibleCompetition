import { describe, expect, it } from "vitest";
import { parseContentPackImport, sampleJoshuaPackJson } from "./contentPackImport";

describe("content pack licensing metadata", () => {
  const payload = (licensingStatus?: unknown) => JSON.stringify({
    ...JSON.parse(sampleJoshuaPackJson()),
    licensingStatus,
  });

  it("preserves supplied public-domain status through JSON parsing", () => {
    expect(parseContentPackImport(payload(" public-domain "))).toMatchObject({
      licensingStatus: "public-domain",
    });
  });

  it.each([undefined, null])("leaves absent status to the server default (%s)", status => {
    expect(parseContentPackImport(payload(status))).not.toHaveProperty("licensingStatus");
  });

  it.each([false, 42, {}, [], "", "  ", "x".repeat(101)].map(status => ({ status })))(
    "rejects invalid supplied status ($status)", ({ status }) => {
      expect(() => parseContentPackImport(payload(status))).toThrow(
        "licensingStatus must be a non-empty string of at most 100 characters.",
      );
    },
  );
});
