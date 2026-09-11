import { describe, expect, it } from "vitest";
import { makeCommand, remainingSeconds, parseQuestionImport } from "./practiceUtils";

describe("authoritative practice client", () => {
  it("never attaches a client response time to commands", () => {
    const command = makeCommand(4, "submit", { answers: ["Paul"] });
    expect(command).toMatchObject({ revision: 4, action: "submit", answers: ["Paul"] });
    expect(command).not.toHaveProperty("responseTimeMs");
    expect(command.commandId).toBeTruthy();
  });
  it("renders countdown against synchronized server time and clamps expiry", () => {
    expect(remainingSeconds("2026-09-10T12:00:25Z", Date.parse("2026-09-10T12:00:20Z"))).toBe(5);
    expect(remainingSeconds("2026-09-10T12:00:25Z", Date.parse("2026-09-10T12:00:26Z"))).toBe(0);
  });
  it("requires an object with a nonempty questions array before importing", () => {
    expect(() => parseQuestionImport("[]")).toThrow();
    expect(() => parseQuestionImport('{"questions":[]}')).toThrow();
    expect(() => parseQuestionImport('{"questions":[{"prompt":"Who?"}]}')).toThrow();
    expect(parseQuestionImport(JSON.stringify({ questions: [{ prompt: "Who?", reference: "Daniel 1:1", evidence: "Text", kind: "ShortAnswer", contentPackId: "pack", sourceUnitId: "unit", parts: [{ acceptedAnswers: ["Paul"], points: 1 }] }] }))).toHaveLength(1);
  });
});
