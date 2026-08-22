namespace Erudoza.Domain;

public enum UserKind
{
    Adult = 1,
    Student = 2
}

public enum OrganizationRole
{
    Owner = 1,
    Admin = 2,
    Student = 3
}

public enum SeasonStatus
{
    Draft = 1,
    ContentReady = 2,
    AssignmentsReady = 3,
    Active = 4,
    Completed = 5,
    Archived = 6
}

public enum AssignmentType
{
    PrimarySpecialist = 1,
    RequiredCoverage = 2,
    OptionalReview = 3
}

public enum ScopeEntryKind
{
    Include = 1,
    Exclude = 2
}

public enum SourceType
{
    Scripture = 1,
    Supplemental = 2
}

public enum KnowledgeUnitKind
{
    ExactVerseText = 1,
    Fact = 2,
    Sequence = 3
}

public enum QuestionLifecycleStatus
{
    Generated = 1,
    Validated = 2,
    NeedsReview = 3,
    Approved = 4,
    Playable = 5,
    Retired = 6,
    Rejected = 7,
    Stale = 8
}

public enum StudyMode
{
    Practice = 1,
    Review = 2,
    Simulation = 3
}

public enum StudySessionStatus
{
    Created = 1,
    Active = 2,
    Completed = 3,
    Abandoned = 4
}

public enum AnswerMode
{
    ExactText = 1,
    ShortFact = 2,
    OrderedSequence = 3,
    SelectedChoice = 4
}

public enum MasteryLevel
{
    Unseen = 1,
    Learning = 2,
    Review = 3,
    Strong = 4,
    Mastered = 5
}

public enum MasteryDimension
{
    Recognition = 1,
    ExactWording = 2,
    Reference = 3,
    Sequence = 4,
    FactualRecall = 5
}

public enum GenerationJobStatus
{
    Queued = 1,
    Running = 2,
    Completed = 3,
    Failed = 4,
    Retryable = 5
}
