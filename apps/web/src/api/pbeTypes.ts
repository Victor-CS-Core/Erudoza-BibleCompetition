export interface PbeQuestionView {
  id: string;
  version: number;
  prompt: string;
  reference: string;
  kind: "ShortAnswer" | "List" | "ExactWords" | "TrueFalse";
  partPoints: number[];
  points: number;
  durationSeconds: number;
}

/** Coach authoring contract; corrected text requires a new pack and source identity. */
export interface PbeIntroductionInput {
  bookKey: string;
  sourceEdition: string;
  title: string;
  citation: string;
  licensingStatus: 'pending' | 'approved' | 'public-domain' | 'creative-commons';
  units: { citation: string; canonicalText: string }[];
}
export interface PbeIntroductionView extends PbeIntroductionInput {
  id: string;
  organizationId: string;
  seasonId: string;
  reviewed: boolean;
  revision: number;
  assignedStudentIds: string[];
  units: { id: string; citation: string; canonicalText: string }[];
}
export interface PbeSourceView {
  id: string;
  contentPackId: string;
  sourceKind: 'Scripture' | 'Commentary';
  bookKey: string;
  chapter: number | null;
  verse: number | null;
  ordinal: number;
  citation: string;
  canonicalText: string;
}
