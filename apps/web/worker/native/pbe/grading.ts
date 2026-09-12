import type { PbeGrade, PbeQuestion, PbeTarget } from "./types";
import type { PbeQuestionView } from "../../../src/api/pbeTypes";
import { responseSeconds } from "./rules";

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = new Set(["ShortAnswer", "List", "ExactWords", "TrueFalse"]);
const SOURCE_KINDS = new Set(["Scripture", "Commentary"]);
const SKILLS = new Set(["FactualRecall", "ExactWords"]);

const requiredText = (value: unknown, max = 10_000): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;
const guid = (value: unknown): value is string => typeof value === "string" && GUID.test(value) && value !== "00000000-0000-0000-0000-000000000000";
const exactKeys = (value: object, keys: string[]) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};
const guidArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length > 0 && value.length <= 50 && value.every(guid) && new Set(value.map((id) => id.toLowerCase())).size === value.length;

// Matches the established native/C# contract: NFC, invariant-like simple case,
// and .NET whitespace only. Punctuation and word order remain significant.
const normalize = (text: string) => Array.from(text.normalize("NFC")).map((character) => {
  const upper = character.toUpperCase();
  return upper.length === character.length ? upper : character;
}).join("")
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0009-\u000d\u0085\p{Z}]+/gu, " ").replace(/^ +| +$/g, "");

export function validatePbeQuestion(question: PbeQuestion, targets: PbeTarget[]): void {
  if (!question || typeof question !== "object" || !exactKeys(question, ["schemaVersion", "id", "version", "contentPackId", "sourceUnitId", "sourceUnitIds", "sourceKind", "reference", "evidence", "kind", "prompt", "ordered", "parts"]))
    throw new Error("Malformed PBE question.");
  if (question.schemaVersion !== 2 || !guid(question.id) || !Number.isInteger(question.version) || question.version < 1 || !guid(question.contentPackId) || !guid(question.sourceUnitId))
    throw new Error("PBE question identity and version are invalid.");
  if (!guidArray(question.sourceUnitIds) || !question.sourceUnitIds.some((id) => id.toLowerCase() === question.sourceUnitId.toLowerCase()) || !SOURCE_KINDS.has(question.sourceKind) || !requiredText(question.reference) || !requiredText(question.evidence) || !requiredText(question.prompt) || typeof question.ordered !== "boolean" || !KINDS.has(question.kind))
    throw new Error("PBE question source and prompt are invalid.");
  if (!Array.isArray(targets) || targets.length < 1 || targets.length > 50 || targets.some((target) => !target || typeof target !== "object" || !exactKeys(target, ["id", "sourceUnitIds", "skill", "label"]) || !guid(target.id) || !guidArray(target.sourceUnitIds) || !SKILLS.has(target.skill) || !requiredText(target.label)))
    throw new Error("PBE targets are invalid.");
  const byId = new Map(targets.map((target) => [target.id.toLowerCase(), target]));
  if (byId.size !== targets.length || !Array.isArray(question.parts) || question.parts.length < 1 || question.parts.length > 50)
    throw new Error("PBE question parts are invalid.");
  let total = 0;
  const referencedSources = new Set<string>();
  for (const part of question.parts) {
    if (!part || typeof part !== "object" || !exactKeys(part, ["targetId", "acceptedAnswers", "points"]) || !guid(part.targetId) || !Number.isInteger(part.points) || part.points < 1 || part.points > 8 || !Array.isArray(part.acceptedAnswers) || part.acceptedAnswers.length < 1 || part.acceptedAnswers.length > 50 || part.acceptedAnswers.some((answer) => !requiredText(answer, 2_000)))
      throw new Error("PBE question parts are invalid.");
    const target = byId.get(part.targetId.toLowerCase());
    if (!target) throw new Error("PBE question part references an unknown target.");
    if (question.kind === "ExactWords" && target.skill !== "ExactWords") throw new Error("Exact-words questions require exact-words targets.");
    for (const source of target.sourceUnitIds) {
      if (!question.sourceUnitIds.some((id) => id.toLowerCase() === source.toLowerCase())) throw new Error("Target source is outside the question source coverage.");
      referencedSources.add(source.toLowerCase());
    }
    total += part.points;
  }
  if (total < 1 || total > 8) throw new Error("PBE questions require 1–8 points.");
  if (question.sourceUnitIds.some((source) => !referencedSources.has(source.toLowerCase()))) throw new Error("Question source coverage must be covered by its targets.");
  if (question.kind === "TrueFalse" && (question.parts.length !== 1 || new Set(question.parts[0].acceptedAnswers.map(normalize)).size !== 1 || !question.parts[0].acceptedAnswers.every((answer) => ["TRUE", "FALSE"].includes(normalize(answer)))))
    throw new Error("True/false questions require one unambiguous answer.");
}

function validateForGrade(question: PbeQuestion, answers: string[]): void {
  if (!question || typeof question !== "object" || !exactKeys(question, ["schemaVersion", "id", "version", "contentPackId", "sourceUnitId", "sourceUnitIds", "sourceKind", "reference", "evidence", "kind", "prompt", "ordered", "parts"]) || question.schemaVersion !== 2 || !guid(question.id) || !Number.isInteger(question.version) || question.version < 1 || !guid(question.contentPackId) || !guid(question.sourceUnitId) || !guidArray(question.sourceUnitIds) || !question.sourceUnitIds.some((id) => id.toLowerCase() === question.sourceUnitId.toLowerCase()) || !SOURCE_KINDS.has(question.sourceKind) || !requiredText(question.reference) || !requiredText(question.evidence) || !requiredText(question.prompt) || !Array.isArray(question.parts) || !question.parts.length || question.parts.length > 50 || !KINDS.has(question.kind) || typeof question.ordered !== "boolean") throw new Error("Malformed PBE question.");
  if (!Array.isArray(answers) || answers.length !== question.parts.length || answers.some((answer) => typeof answer !== "string" || answer.length > 2_000)) throw new Error("Provide exactly one answer for each PBE part.");
  let total = 0;
  for (const part of question.parts) {
    if (!part || typeof part !== "object" || !exactKeys(part, ["targetId", "acceptedAnswers", "points"]) || !guid(part.targetId) || !Number.isInteger(part.points) || part.points < 1 || part.points > 8 || !Array.isArray(part.acceptedAnswers) || !part.acceptedAnswers.length || part.acceptedAnswers.length > 50 || part.acceptedAnswers.some((answer) => !requiredText(answer, 2_000))) throw new Error("Malformed PBE question parts.");
    total += part.points;
  }
  responseSeconds(total);
}

export function gradePbe(question: PbeQuestion, answers: string[]): PbeGrade {
  validateForGrade(question, answers);
  const submitted = answers.map(normalize);
  const accepted = question.parts.map((part) => new Set(part.acceptedAnswers.map(normalize)));
  const answerForPart = new Array<number>(question.parts.length).fill(-1);
  if (question.ordered || question.kind === "ExactWords") {
    question.parts.forEach((_part, index) => { if (accepted[index].has(submitted[index])) answerForPart[index] = index; });
  } else {
    const partForAnswer = new Array<number>(answers.length).fill(-1);
    const assign = (part: number, visited: boolean[]): boolean => {
      for (let answer = 0; answer < answers.length; answer++) {
        if (visited[answer] || !accepted[part].has(submitted[answer])) continue;
        visited[answer] = true;
        const displaced = partForAnswer[answer];
        if (displaced < 0 || assign(displaced, visited)) {
          partForAnswer[answer] = part;
          answerForPart[part] = answer;
          return true;
        }
      }
      return false;
    };
    [...question.parts.keys()].sort((a, b) => question.parts[b].points - question.parts[a].points || a - b).forEach((part) => assign(part, new Array(answers.length).fill(false)));
  }
  const parts = question.parts.map((part, index) => ({ index, targetId: part.targetId, answerIndex: answerForPart[index] < 0 ? null : answerForPart[index], earnedPoints: answerForPart[index] < 0 ? 0 : part.points, availablePoints: part.points }));
  return { earnedPoints: parts.reduce((sum, part) => sum + part.earnedPoints, 0), availablePoints: parts.reduce((sum, part) => sum + part.availablePoints, 0), parts };
}

export function questionView(question: PbeQuestion): PbeQuestionView {
  validateForGrade(question, new Array(question.parts.length).fill(""));
  const partPoints = question.parts.map((part) => part.points);
  const points = partPoints.reduce((sum, value) => sum + value, 0);
  return { id: question.id, version: question.version, prompt: question.prompt, reference: question.reference, kind: question.kind, partPoints, points, durationSeconds: responseSeconds(points) };
}
