import { describe, expect, it } from "vitest";
import { parseCoffeeProfile } from "./coffeeConfig";

describe("parseCoffeeProfile", () => {
  it.each([
    "https://buymeacoffee.com/TestCreator",
    " https://www.buymeacoffee.com/TestCreator/ ",
    "https://buymeacoffee.com:443/TestCreator",
  ])("derives a safe canonical profile from %s", value => {
    expect(parseCoffeeProfile(value)).toEqual({
      creatorId: "TestCreator",
      url: "https://buymeacoffee.com/TestCreator",
    });
  });

  it.each([
    undefined, "", "   ", "TestCreator", "http://buymeacoffee.com/TestCreator",
    "https://buymeacoffee.com", "https://buymeacoffee.com/", "https://buymeacoffee.com/a/b",
    "https://buymeacoffee.com.evil.example/TestCreator", "https://other.example/TestCreator",
    "https://member.buymeacoffee.com/TestCreator", "https://user@buymeacoffee.com/TestCreator",
    "https://@buymeacoffee.com/TestCreator", "https://buymeacoffee.com:8443/TestCreator",
    "https://buymeacoffee.com/TestCreator?amount=10", "https://buymeacoffee.com/TestCreator?",
    "https://buymeacoffee.com/TestCreator#support", "https://buymeacoffee.com/TestCreator#",
    "https://buymeacoffee.com/Test%2FCreator", "https://buymeacoffee.com/a/../TestCreator",
    "https://buymeacoffee.com/Test\nCreator", "https://buymeacoffee.com/<script>",
    "https://buymeacoffee.com/.", "javascript:alert(1)",
  ])("disables support for missing or unsafe value %s", value => {
    expect(parseCoffeeProfile(value)).toBeNull();
  });
});
