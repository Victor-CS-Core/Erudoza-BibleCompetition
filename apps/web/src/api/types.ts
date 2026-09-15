export type TrainingDifficulty = "Foundation" | "Standard" | "Advanced";

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

export type Student = { userId: string; userName: string; displayName: string; email: string | null; isActive?: boolean };


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

export type ScriptureCatalog = {
  translations: { id: string; name: string; license: string; language: string }[];
  books: { bookKey: string; name: string }[];
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
  contentPackId?: string;
  difficulty?: TrainingDifficulty;
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

/** Short student-facing note about a coach's assignment change. */
export type UserNotification = {
  id: string;
  seasonId: string;
  seasonName: string;
  studentUserId: string;
  actorUserId: string;
  actorDisplayName: string;
  action: "added" | "removed" | "updated";
  citation: string;
  summary: string;
  readAtUtc: string | null;
  createdAtUtc: string;
};

export type NotificationList = {
  notifications: UserNotification[];
  unreadCount: number;
};

export type ChallengeCard = {
  generatorVersion?: string | null;
  evidenceProfile?: "memory-cued-v3" | "memory-honor-v2" | null;
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

export interface MissingWordAnswer { index: number; text: string }
export interface MissingWordResult { index: number; isCorrect: boolean; expected: string }
export interface MissingWordAnswerPayload {
  format: 'missing-words-slots/v1';
  answers: MissingWordAnswer[];
  results: MissingWordResult[];
}
export type SubmitAttemptBody = {
  clientSubmissionId: string; challengeCardId: string; responseTimeMs: number; hintsUsed: boolean;
} & ({ submittedAnswer: string; missingWordAnswers?: never } | { submittedAnswer?: never; missingWordAnswers: MissingWordAnswer[] });

export type AttemptResult = {
  missingWordAnswers?: MissingWordAnswer[];
  missingWordResults?: MissingWordResult[];
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
  pbeEnabled?: boolean;
  seasonId: string;
  seasonName: string;
  seasonStatus: string;
  assignments: Assignment[];
  masteredCount: number;
  reviewDueCount: number;
  attemptCount: number;
  studentUserId?: string;
  studentDisplayName?: string;
  recentAttempts?: {
    id: string;
    title: string;
    activityType: string;
    isCorrect: boolean;
    submittedAnswer: string;
    evaluationResult: string;
    createdAtUtc: string;
  }[];
  mastery: {
    knowledgeUnitId: string;
    title: string;
    level: string;
    exactWordingScore: number;
    recognitionScore: number;
    referenceScore?: number;
    sequenceScore?: number;
    factualRecallScore?: number;
    bookKey?: string;
    chapter?: number;
    verse?: number;
    algorithmVersion?: string;
    reviewDueAtUtc: string | null;
  }[];
};

export type Session = {
  memoryChallenge?: "Warmup" | "Advanced" | null;
  generatorVersion?: string | null;
  evidenceProfile?: "memory-cued-v3" | "memory-honor-v2" | null;
  format?: "Memory" | "Pbe";
  difficulty?: TrainingDifficulty;
  id: string;
  seasonId: string;
  status: string;
  mode: string;
  targetCardCount: number;
};

export type SessionSummary = {
  recap?: import("./trainingTypes").SessionRecap;
  sessionId: string;
  mode: string;
  attempted: number;
  correct: number;
  targetCardCount: number;
  status: string;
  earnedPoints?: number;
  availablePoints?: number;
  results?: { attemptId:string;earnedPoints:number;availablePoints:number;acceptedAtUtc:string }[];
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

export type SeasonCoverage = {
  seasonId: string;
  seasonName: string;
  seasonStatus: string;
  students: CoverageStudent[];
};

export type ResumedSession = { session: Session; card: ChallengeCard | null; attempt: AttemptResult | null; summary: SessionSummary | null };

export type PassageRange = { bookKey: string; startChapter: number; startVerse: number; endChapter: number; endVerse: number };
export type PackScope = { contentPackId: string; includes: PassageRange[]; excludes: PassageRange[] };
export type SeasonScope = { contentPackId: string | null; includes: PassageRange[]; excludes: PassageRange[]; packs?: PackScope[] };
export type LibraryBook = { contentPackId: string; bookKey: string; name: string; verseCount: number; chapters: { number: number; verses: number[] }[] };
export type ScriptureLibrary = { translationId: "nkjv"; translationName: string; version: number; books: LibraryBook[] };
export type NotebookKind = 'highlight' | 'note' | 'bookmark';
export type HighlightColor = 'Promises' | 'People' | 'Review';
export type NotebookEntryInput = {
  kind: NotebookKind; contentPackId: string; chapter: number;
  sourceUnitId: string | null; startOffset: number | null; endOffset: number | null;
  color: HighlightColor | null; note: string | null;
};
export type NotebookEntry = NotebookEntryInput & { id: string; bookName: string; citation: string; quote: string; updatedAtUtc: string };
export type StudyNotebook = { version: number; entries: NotebookEntry[] };
