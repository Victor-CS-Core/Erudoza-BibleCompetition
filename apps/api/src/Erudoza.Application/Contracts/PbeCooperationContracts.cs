namespace Erudoza.Application.Contracts;

public sealed record PbeCountRange(int Known, int Possible);
public sealed record PbeEqualRetained(double Lower, double Upper, int Students, int UnknownStudents, int UnassignedStudents);
public sealed record PbeMaterialSummary(int Assigned, PbeCountRange QuestionCovered, PbeCountRange Practiced, PbeCountRange Retained, PbeCountRange Due, PbeEqualRetained? EqualRetained);
public sealed record PbeOwnMaterialSummary(int Assigned, PbeCountRange Practiced, PbeCountRange Retained, PbeCountRange Due);
public sealed record PbeOwnSummary(PbeOwnMaterialSummary Scripture, PbeOwnMaterialSummary Introduction, string State);
public sealed record PbeCooperationWork(string? Id, string Next);
public sealed record PbeCooperationSnapshot(Guid SeasonId, string RuleVersion, string? ScopeVersion, string? SnapshotId,
    string State, string? Reason, DateTimeOffset? CheckedAtUtc, DateTimeOffset? DueRefreshAtUtc, int RosterStudents, int UnknownStudents,
    PbeMaterialSummary? Scripture, PbeMaterialSummary? Introduction, PbeOwnSummary? Own, PbeCooperationWork Work);
public sealed record PbeCooperationStudent(string StudentId, string DisplayName, string State, string? Reason, PbeOwnMaterialSummary Scripture, PbeOwnMaterialSummary Introduction);
public sealed record PbeCooperationStudents(Guid SeasonId, string SnapshotId, string? NextCursor, IReadOnlyList<PbeCooperationStudent> Items);
