import { describe, expect, it } from "vitest";
import { apiUrl } from "./url";

describe("apiUrl", () => {
  it("keeps same-origin paths when no base is set", () => {
    expect(apiUrl("/api/v1/me", "")).toBe("/api/v1/me");
    expect(apiUrl("/api/v1/me", undefined)).toBe("/api/v1/me");
  });

  it("prefixes a Firebase or remote API origin without a trailing slash", () => {
    expect(apiUrl("/api/v1/me", "https://api.erudoza.com/")).toBe("https://api.erudoza.com/api/v1/me");
  });
});
