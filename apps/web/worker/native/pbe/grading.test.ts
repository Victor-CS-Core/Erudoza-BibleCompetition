// @vitest-environment node
import { describe, expect, it } from "vitest";
import fixtures from "./rubric-fixtures.json";
import { gradePbe, questionView, validatePbeQuestion } from "./grading";
import { responseSeconds } from "./rules";
import type { PbeQuestion, PbeTarget } from "./types";

const question: PbeQuestion = {
  schemaVersion: 2,
  id: "00000000-0000-0000-0000-000000000001",
  version: 1,
  contentPackId: "00000000-0000-0000-0000-000000000002",
  sourceUnitId: "00000000-0000-0000-0000-000000000003",
  sourceUnitIds: ["00000000-0000-0000-0000-000000000003"],
  sourceKind: "Scripture",
  reference: "Fixture 1:1",
  evidence: "Alpha and Beta",
  kind: "List",
  prompt: "Name both fixture labels.",
  ordered: false,
  parts: [
    { targetId: "00000000-0000-0000-0000-000000000004", acceptedAnswers: ["Alpha"], points: 1 },
    { targetId: "00000000-0000-0000-0000-000000000005", acceptedAnswers: ["Beta"], points: 1 },
  ],
};

it("awards each correct part once and preserves the missing target", () => {
  expect(gradePbe(question, ["Beta", "wrong"])).toMatchObject({
    earnedPoints: 1,
    availablePoints: 2,
    parts: [{ index: 0, earnedPoints: 0 }, { index: 1, answerIndex: 0, earnedPoints: 1 }],
  });
  expect(() => gradePbe(question, ["wrong", "Alpha", "Beta"])).toThrow();
});

describe("shared rubric fixtures", () => {
  for (const fixture of fixtures.cases) {
    it(fixture.name, () => {
      validatePbeQuestion(fixture.question as PbeQuestion, fixtures.targets as PbeTarget[]);
      expect(gradePbe(fixture.question as PbeQuestion, fixture.answers)).toEqual(fixture.expected);
    });
  }
});

it("enforces source coverage, exact skill, GUIDs, arrays and the 1–8 point boundary", () => {
  const target: PbeTarget = { id: question.parts[0].targetId, sourceUnitIds: question.sourceUnitIds, skill: "FactualRecall", label: "Alpha" };
  const second: PbeTarget = { id: question.parts[1].targetId, sourceUnitIds: question.sourceUnitIds, skill: "FactualRecall", label: "Beta" };
  expect(() => validatePbeQuestion(question, [target, second])).not.toThrow();
  expect(() => validatePbeQuestion({ ...question, sourceUnitIds: [...question.sourceUnitIds, "00000000-0000-0000-0000-000000000099"] }, [target, second])).toThrow(/coverage/);
  expect(() => validatePbeQuestion({ ...question, id: "not-a-guid" }, [target, second])).toThrow(/identity/);
  expect(() => validatePbeQuestion({ ...question, kind: "ExactWords" }, [target, second])).toThrow(/exact-words targets/);
  expect(() => validatePbeQuestion({ ...question, parts: [{ ...question.parts[0], points: 8 }] }, [target])).not.toThrow();
  expect(() => validatePbeQuestion({ ...question, parts: [{ ...question.parts[0], points: 9 }] }, [target])).toThrow(/1–8|parts/);
  expect(() => validatePbeQuestion({ ...question, parts: [] }, [target])).toThrow(/parts/);
  expect(() => validatePbeQuestion({ ...question, unexpected: true } as unknown as PbeQuestion, [target, second])).toThrow(/Malformed/);
  const mixedSource = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  expect(() => validatePbeQuestion({ ...question, sourceUnitId: mixedSource.toUpperCase(), sourceUnitIds: [mixedSource] }, [{ ...target, sourceUnitIds: [mixedSource.toUpperCase()] }, { ...second, sourceUnitIds: [mixedSource] }])).not.toThrow();
});

it("returns a timed public view without answer or evidence fields", () => {
  expect(questionView(question)).toEqual({ id: question.id, version: 1, prompt: question.prompt, reference: question.reference, kind: "List", partPoints: [1, 1], points: 2, durationSeconds: 30 });
  expect(JSON.stringify(questionView(question))).not.toMatch(/acceptedAnswers|evidence|targetId/);
  expect(responseSeconds(1)).toBe(25);
  expect(responseSeconds(8)).toBe(60);
  expect(() => responseSeconds(9)).toThrow(/1–8/);
});

it("limits v2 versions to the canonical Int32 range in validation and grading", () => {
  const fixture = fixtures.cases[0];
  const max = { ...fixture.question, version: 2147483647 } as PbeQuestion;
  expect(() => validatePbeQuestion(max, fixtures.targets as PbeTarget[])).not.toThrow();
  expect(() => gradePbe(max, fixture.answers)).not.toThrow();
  for (const version of [2147483648, Number.MAX_SAFE_INTEGER + 1]) {
    const invalid = { ...max, version };
    expect(() => validatePbeQuestion(invalid, fixtures.targets as PbeTarget[])).toThrow();
    expect(() => gradePbe(invalid, fixture.answers)).toThrow();
  }
});
