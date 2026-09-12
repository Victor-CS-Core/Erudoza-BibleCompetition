export type RecallSkill = "FactualRecall" | "ExactWords";

export interface PbeTarget {
  id: string;
  sourceUnitIds: string[];
  skill: RecallSkill;
  label: string;
}

export interface PbeQuestionPart {
  targetId: string;
  acceptedAnswers: string[];
  points: number;
}

export interface PbeQuestion {
  schemaVersion: 2;
  id: string;
  version: number;
  contentPackId: string;
  sourceUnitId: string;
  sourceUnitIds: string[];
  sourceKind: "Scripture" | "Commentary";
  reference: string;
  evidence: string;
  kind: "ShortAnswer" | "List" | "ExactWords" | "TrueFalse";
  prompt: string;
  ordered: boolean;
  parts: PbeQuestionPart[];
}

export interface PbeGradePart {
  index: number;
  targetId: string;
  answerIndex: number | null;
  earnedPoints: number;
  availablePoints: number;
}

export interface PbeGrade {
  earnedPoints: number;
  availablePoints: number;
  parts: PbeGradePart[];
}
