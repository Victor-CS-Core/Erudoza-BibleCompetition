export type Me = {
  userId: string;
  organizationId: string;
  organizationName: string;
  displayName: string;
  userName: string;
  email: string | null;
  kind: "Adult" | "Student";
  role: "Owner" | "Admin" | "Student";
};

export type Organization = { id: string; name: string; slug: string };

export type Season = {
  id: string;
  organizationId: string;
  name: string;
  yearLabel: string;
  status: string;
  ruleProfileKey: string;
  ruleProfileVersion: number;
  startDate: string | null;
  targetCompetitionDate: string | null;
  scopeUnitCount: number;
  assignmentCount: number;
};

export type Student = { userId: string; userName: string; displayName: string; email: string | null };

export type ContentPack = {
  id: string;
  packKey: string;
  version: number;
  locale: string;
  sourceType: string;
  licensingStatus: string;
  unitCount: number;
};

export type SourceUnit = {
  id: string;
  citation: string;
  bookKey: string;
  chapter: number;
  verse: number;
  ordinal: number;
  canonicalText: string;
};

export type ImportContentPackRequest = {
  packKey: string;
  version: number;
  locale: string;
  sourceType: string;
  documents: {
    name: string;
    units: {
      citation: string;
      bookKey: string;
      chapter: number;
      verse: number;
      ordinal: number;
      text: string;
    }[];
  }[];
};

export type Assignment = {
  id: string;
  studentUserId: string;
  type: string;
  bookKey: string;
  startChapter: number;
  startVerse: number;
  endChapter: number;
  endVerse: number;
  studentDisplayName?: string | null;
  studentUserName?: string | null;
};

export type ChallengeCard = {
  id: string;
  sessionId: string;
  activityType: string;
  citation: string;
  prompt: string;
  tokens: { display: string; hidden: boolean; index: number }[];
  sequence: number;
  total: number;
  debugAnswer?: string | null;
  choices?: string[] | null;
};

export type AttemptResult = {
  attemptId: string;
  isCorrect: boolean;
  evaluationResult: string;
  canonicalAnswer: string;
  citation: string;
  sourceText: string;
  masteryLevel: string;
  exactWordingScore: number;
  reviewDueAtUtc: string | null;
  alreadyProcessed: boolean;
};

export type Progress = {
  seasonId: string;
  seasonName: string;
  seasonStatus: string;
  assignments: Assignment[];
  masteredCount: number;
  reviewDueCount: number;
  attemptCount: number;
  studentUserId?: string;
  studentDisplayName?: string;
  mastery: {
    knowledgeUnitId: string;
    title: string;
    level: string;
    exactWordingScore: number;
    recognitionScore: number;
    reviewDueAtUtc: string | null;
  }[];
};

export type Session = {
  id: string;
  seasonId: string;
  status: string;
  mode: string;
  targetCardCount: number;
};

export type SessionSummary = {
  sessionId: string;
  mode: string;
  attempted: number;
  correct: number;
  targetCardCount: number;
  status: string;
};

export type CoverageStudent = {
  studentUserId: string;
  displayName: string;
  userName: string;
  assignmentType: string;
  bookKey: string;
  startChapter: number;
  startVerse: number;
  endChapter: number;
  endVerse: number;
  eligibleUnitCount: number;
  masteredCount: number;
  reviewDueCount: number;
  attemptCount: number;
};

export type GenerationJob = {
  id: string;
  seasonId: string | null;
  status: string;
  error: string | null;
  createdAtUtc: string;
  candidateCount: number;
};

export type QuestionReview = {
  id: string;
  seasonId: string | null;
  prompt: string;
  canonicalAnswer: string;
  status: string;
  questionType: string;
  generatorVersion: string;
  explanation: string | null;
  evidence: { sourceUnitId: string; citation: string; evidenceText: string }[];
};

export type SeasonCoverage = {
  seasonId: string;
  seasonName: string;
  seasonStatus: string;
  students: CoverageStudent[];
};
