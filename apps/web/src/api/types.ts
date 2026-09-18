export type TrainingDifficulty = "Foundation" | "Standard" | "Advanced";

export type Me = {
  userId: string;
  organizationId: string;
  organizationName: string;
  displayName: string;
  userName: string;
  email: string | null;
  kind: "Adult" | "Student";
  role: "Owner" | "Admin" | "Content Manager" | "Student";
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
  pbeEnabled?: boolean;
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
  score: number;
  evaluationCode: 'ExactMatch' | 'PartialMatch' | 'Incorrect';
}
export type SubmitAttemptBody = {
  clientSubmissionId: string; challengeCardId: string; responseTimeMs: number; hintsUsed: boolean;
} & ({ submittedAnswer: string; missingWordAnswers?: never } | { submittedAnswer?: never; missingWordAnswers: MissingWordAnswer[] });

export type AttemptResult = {
  missingWordAnswers?: MissingWordAnswer[];
  missingWordResults?: MissingWordResult[];
  attemptId: string;
  isCorrect: boolean;
  score?: number;
  evaluationResult: string;
  canonicalAnswer: string;
  citation: string;
  sourceText: string;
  masteryLevel: string;
  exactWordingScore: number;
  skillKey: string;
  skillLabel: string;
  skillScore: number;
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

export type StudentDashboard = {
  student: { userId: string; displayName: string; userName: string; isActive: boolean };
  season: { id: string; name: string; status: string } | null;
  effort: {
    weeklyTarget: number;
    completedDays: number;
    weekStartLocalDate: string;
    timeZone: string;
    days: { localDate: string; credited: boolean; isToday: boolean }[];
    streakDays: number;
    streakState: "active" | "paused" | "none";
    bestStreak: number;
    streakHistory: { localDate: string; credited: boolean }[];
    sessionsLast7Days: number;
    lastActivityAtUtc: string | null;
  };
  progress: {
    eligibleCount: number;
    seenCount: number;
    strongCount: number;
    masteredCount: number;
    reviewDueCount: number;
    attemptCount: number;
    chapters: {
      bookKey: string;
      chapter: number;
      eligibleCount: number;
      seenCount: number;
      strongCount: number;
      masteredCount: number;
    }[];
  };
  mastery: {
    badges: import("./trainingTypes").BadgeProgress[];
    levelCounts: { level: string; count: number }[];
    teamAwards: { key: string; title: string; seasonName: string | null; earnedAtUtc: string | null; source: "honor" | "award" }[];
  };
  assignments: Assignment[];
  social: {
    leaderboardOptIn: boolean;
    teamPracticeSessions: number;
  };
  recentActivity: {
    sessionId: string;
    mode: string;
    format: string | null;
    createdAtUtc: string;
    completedAtUtc: string | null;
    attempted: number;
    correct: number | null;
    fullTargetReached: boolean | null;
  }[];
};

/** Coach engagement overview row (gamification §7b): at-a-glance "who's fading" view. */
export type EngagementRow = {
  studentId: string;
  name: string;
  streak: number;
  xpThisWeek: number;
  practiceDaysThisWeek: number;
  lastActiveAtUtc: string | null;
  level: number;
  levelName: string;
  honorsEarned: number;
  quests: { completedThisWeek: number; totalThisWeek: number; rate: number };
};

/** Gamification Phase 3 §4 — peer momentum: team activity strip data. */
export type TeamActivity = {
  practicedToday: number;
  practicedThisWeek: number;
  memberCount: number;
};

/** Gamification Phase 3 §4 — one weekly leaderboard row. */
export type LeaderboardEntry = {
  userId: string;
  displayName: string;
  xp: number;
  level: number;
  levelName: string;
};

/** Gamification Phase 3 §4 — weekly XP leaderboard response. */
export type LeaderboardResponse = {
  weekStartLocalDate: string;
  entries: LeaderboardEntry[];
  me: { userId: string; rank: number | null; xp: number; optedIn: boolean } | null;
};

/** One entry in a student's paginated session history (gamification §7c). */
export type SessionHistoryEntry = {
  sessionId: string;
  format: "Memory" | "Pbe" | "Room";
  mode: string;
  completedAtUtc: string | null;
  attempted: number;
  correct: number | null;
  xpEarned: number;
  /** Present only when format === "Room". */
  roomId?: string;
  teamFormat?: "Pbe" | "Arcade";
};

export type SessionHistoryPage = {
  sessions: SessionHistoryEntry[];
  nextBefore: string | null;
};

/** One section of a yearly PBE Bible commentary introduction. */
export type PbeCommentarySection = { heading: string; body: string };

/** Deep links back to the original NAD source material. */
export type PbeMaterialSourceUrls = {
  versesPdf?: string;
  commentaryPdf?: string;
  resourcesPage: string;
};

export type PbeMaterialRosterBook = { bookKey: string; bookName: string; chapters: number[] };

/** Live, approved PBE release for a competition year (kind='pbe-material'). */
export type PbeMaterial = {
  id: string;
  yearLabel: string;
  books: PbeMaterialRosterBook[];
  commentary: { bookName: string; title: string; sections: PbeCommentarySection[] };
  sourceUrls: PbeMaterialSourceUrls;
  approvedBy: string;
  approvedAtUtc: string;
  releaseNote?: string;
  version: number;
};

/** Summary DTO returned by GET /pbe-materials for live releases. */
export type PbeMaterialSummary = {
  yearLabel: string;
  books: PbeMaterialRosterBook[];
  commentary: { bookName: string; title: string; sectionHeadings: string[] };
  sourceUrls: PbeMaterialSourceUrls;
  approvedAtUtc: string;
};

/** Draft payload for a proposal create/update (no id/status/version). */
export type PbeMaterialDraftPayload = {
  yearLabel: string;
  books: PbeMaterialRosterBook[];
  commentary: { bookName: string; title: string; sections: PbeCommentarySection[] };
  sourceUrls: PbeMaterialSourceUrls;
};

export type PbeMaterialProposalStatus = "draft" | "approved" | "rejected";

/** The review pipeline record (kind='pbe-material-proposal'). */
export type PbeMaterialProposal = {
  id: string;
  yearLabel: string;
  status: PbeMaterialProposalStatus;
  origin: "watcher" | "manual";
  proposedBy: string;
  proposedAtUtc: string;
  material: PbeMaterialDraftPayload;
  reviewNote?: string;
  decidedBy?: string | null;
  decidedAtUtc?: string | null;
};

/** Summary DTO for the proposal list. */
export type PbeMaterialProposalSummary = {
  id: string;
  yearLabel: string;
  status: PbeMaterialProposalStatus;
  origin: "watcher" | "manual";
  proposedBy: string;
  proposedAtUtc: string;
  decidedBy?: string | null;
  decidedAtUtc?: string | null;
};

/** Diff of a proposal against the current live release for the same year. */
export type PbeMaterialDiff = {
  booksChanged: boolean;
  addedSections: string[];
  removedSections: string[];
  changedSections: string[];
  rosterChanged: boolean;
};

export type PbeMaterialWatchDraft = { proposalId: string; yearLabel: string; title: string; sourceUrl: string };
export type PbeMaterialWatchResult = { checkedAt: string; mediaChecked: number; drafted: PbeMaterialWatchDraft[] };

/** One section of a PBE news article body. */
export type PbeNewsSection = { heading: string; body: string };

/** Article kind driving the feed art strip and kicker. Unknown values fall back to "announcement". */
export type PbeNewsArticleType = "competition" | "study-material" | "rule-update" | "announcement";

/** A reading-material deep link shown on the feed card and inside the article. */
export type PbeNewsLinkedMaterial = { label: string; href: string; hint?: string };

/** News article record (kind='pbe-news-article'); students only ever see published articles. */
export type PbeNewsArticle = {
  id: string;
  title: string;
  summary: string;
  sections: PbeNewsSection[];
  sourceUrl?: string;
  sourceLabel?: string;
  status: "draft" | "published";
  createdBy: string;
  createdAtUtc: string;
  updatedAtUtc: string;
  publishedAtUtc?: string;
  publishedBy?: string;
  articleType?: PbeNewsArticleType;
  keyPoints?: string[];
  linkedMaterials?: PbeNewsLinkedMaterial[];
  readMinutes?: number;
};

/** Feed DTO returned by GET /pbe-news (published articles, newest first). */
export type PbeNewsArticleSummary = {
  id: string;
  title: string;
  summary: string;
  publishedAtUtc: string | null;
  sourceUrl?: string | null;
  sourceLabel?: string | null;
  articleType?: PbeNewsArticleType;
  keyPoints?: string[];
  linkedMaterials?: PbeNewsLinkedMaterial[];
  readMinutes?: number;
};

/** Create/update payload for a news article (publish state is separate). */
export type PbeNewsArticleInput = {
  title: string;
  summary: string;
  sections: PbeNewsSection[];
  articleType: PbeNewsArticleType;
  keyPoints?: string[];
  linkedMaterials?: PbeNewsLinkedMaterial[];
  readMinutes?: number;
  sourceUrl?: string;
  sourceLabel?: string;
};

/** Draft suggestion returned by POST /pbe-news/extract for a pasted source URL. */
export type PbeNewsExtractDraft = {
  title: string;
  summary: string;
  keyPoints: string[];
  sections: PbeNewsSection[];
  sourceUrl: string;
  sourceLabel: string;
};
