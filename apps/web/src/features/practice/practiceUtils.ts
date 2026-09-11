import type { PracticeCommand, PracticeQuestion } from "../../api/practice";

export function makeCommand(revision: number, action: string, payload: Omit<PracticeCommand, "revision" | "action" | "commandId"> = {}): PracticeCommand {
  return { ...payload, revision, action, commandId: crypto.randomUUID() };
}
export function remainingSeconds(deadline: string | undefined, serverNow: number): number {
  return deadline ? Math.max(0, Math.ceil((Date.parse(deadline) - serverNow) / 1000)) : 0;
}
export function parseQuestionImport(text: string): PracticeQuestion[] {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || !("questions" in value) || !Array.isArray(value.questions) || !value.questions.length) throw new Error("Provide an object with a nonempty questions array. All questions are validated together before saving.");
  for (const question of value.questions) {
    if (!question || typeof question !== "object" || typeof question.prompt !== "string" || !Array.isArray(question.parts) || !question.parts.length || question.parts.some((part: { acceptedAnswers?: unknown; points?: unknown } | null) => !part || !Array.isArray(part.acceptedAnswers) || !part.acceptedAnswers.length || part.acceptedAnswers.some(answer => typeof answer !== "string") || typeof part.points !== "number")) throw new Error("Each question needs a text prompt and scoring parts with acceptedAnswers and numeric points.");
    for (const field of ["reference", "evidence", "kind", "contentPackId", "sourceUnitId"]) if (typeof question[field] !== "string") throw new Error(`Each question needs a text ${field}.`);
  }
  return value.questions as PracticeQuestion[];
}
export const points = (hundredths: number) => (hundredths / 100).toFixed(2);
