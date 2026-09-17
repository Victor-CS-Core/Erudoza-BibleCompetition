export type WeeklyTarget = 3 | 4 | 5;
export type TrainingStepKind = "Review" | "Practice" | "Simulation";
export type MissionStatus = "Suggested" | "Active" | "Complete" | "Invalidated" | "Unavailable";
export type BadgeKey = "exact-recall" | "reference-ready" | "chapter-strong" | "full-coverage" | "steady-study" | "review-complete" | "streak-7" | "streak-14" | "streak-30";
export type SkillScores = {
    exactWording: number;
    recognition: number;
    reference: number;
    sequence: number;
    factualRecall: number;
};
export type TrainingPreferences = {
    timeZone: string;
    weeklyTarget: WeeklyTarget;
    pending: {
        timeZone: string;
        weeklyTarget: WeeklyTarget;
        effectiveAtUtc: string;
    } | null;
};
export type TrainingStep = {
    kind: TrainingStepKind;
    target: number;
    completed: number;
    status: "NotNeeded" | "Pending" | "Active" | "Complete" | "Invalidated";
    sessionId: string | null;
};
export type BadgeProgress = {
    key: BadgeKey;
    ruleVersion: "training-v1";
    title: string;
    completed: number;
    target: number;
    earnedAtUtc: string | null;
    scopeLabel: string;
    evidenceSessionId: string | null;
};
export type TrainingWeek = {
    weekStartLocalDate: string;
    timeZone: string;
    target: WeeklyTarget;
    completedDays: number;
    days: {
        localDate: string;
        credited: boolean;
        isToday: boolean;
    }[];
};
export type TrainingToday = {
    format?: "Memory" | "Pbe";
    seasonId: string | null;
    seasonName: string;
    seasonStatus: string;
    localDate: string;
    preferences: TrainingPreferences;
    week: TrainingWeek;
    mission: {
        id: string | null;
        revision: number | null;
        status: MissionStatus;
        scopeVersion: string | null;
        steps: TrainingStep[];
        explanation: string | null;
    };
    nextAction: {
        label: string;
        mode: "Practice" | "Review" | "Simulation";
        sessionId: string | null;
    } | null;
    honors: BadgeProgress[];
    streak: {
        current: number;
        best: number;
        state: "active" | "paused" | "none";
    };
};
export type SessionRecap = {
    version: "training-v1" | "legacy-counts" | "pbe-daily-v2";
    sessionId: string;
    seasonId: string;
    mode: string;
    completedAtUtc: string | null;
    attempted: number;
    correct: number;
    targetCardCount: number;
    fullTargetReached: boolean;
    newlyCreditedDay: boolean;
    missionLocalDate: string | null;
    creditedLocalDate: string | null;
    /** True when this session completed the learner's weekly practice goal. */
    weeklyGoalComplete: boolean;
    /** Set when this session set a personal best (Memory sessions). */
    personalBest: { accuracyBeaten: boolean; correctBeaten: boolean } | null;
    missionSteps: TrainingStep[];
    earnedBadges: BadgeProgress[];
    passageChanges: {
        knowledgeUnitId: string;
        title: string;
        delta: SkillScores;
        before: SkillScores | null;
        after: SkillScores | null;
        events: {
            attemptId: string;
            acceptedAtUtc: string;
            before: SkillScores;
            after: SkillScores;
        }[];
    }[];
    interrupted?: boolean;
    results?: { attemptId:string;questionId?:string;earnedPoints:number;originalEarnedPoints?:number;availablePoints:number;acceptedAtUtc:string;dispute?:{id:string;status:"Pending"|"Resolved";revision:number;questionId:string;questionVersion:number;pointsByPart:number[]|null}|null }[] | null;
    provisional?: boolean;
    pendingCount?: number;
    finalizedEarnedPoints?: number;
    finalizedAvailablePoints?: number;
};
export type StartTrainingContext = {
    clientStartId: string;
    timeZone?: string;
    missionId?: string;
    missionRevision?: number;
    step?: TrainingStepKind;
};
export type PassageJourneyPage = {
    seasonId: string;
    scopeVersion: string;
    after: string | null;
    chapters: {
        bookKey: string;
        chapter: number;
        scopeLabel: "Assigned scope";
        eligibleCount: number;
        seenCount: number;
        strongCount: number;
        passages: {
            knowledgeUnitId: string;
            title: string;
            level: string;
            algorithmVersion: string;
            skills: SkillScores;
            dueAtUtc: string | null;
        }[];
    }[];
};

export type {ChapterCounts,ProgressAction,StampSummary,ProgressRow,ChapterWork,ChapterPage,ContinueChaptersRequest,ContinueChaptersResponse} from './pbeTypes';

export type {CountRange,MaterialSummary,OwnMaterialSummary,OwnSummary,CooperationWork,CooperationSnapshot,ContinueCooperationRequest,ContinueCooperationResponse,CooperationStudentSummary,CooperationStudentPage,PbeProgressScope,PbeSessionSelection} from './pbeTypes';
