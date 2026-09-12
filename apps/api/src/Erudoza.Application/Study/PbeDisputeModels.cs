using Erudoza.Domain.Practice;
namespace Erudoza.Application.Study;

public sealed record PbeDisputeFlag(string Activity, string SessionId, string AttemptId, string Reason);
public sealed record PbeDisputeResolve(long ExpectedRevision, int[] PointsByPart, string Reason);
public sealed record PbeDisputeResolution(int[] PointsByPart, string Reason, Guid ResolvedBy, DateTimeOffset ResolvedAtUtc);
public sealed record PbeFrozenAttempt(Guid SessionId, Guid SeasonId, string AttemptId, int? Team, PbeQuestion Question, string[] Answers, DateTimeOffset AcceptedAtUtc, Guid[] ParticipantIds, Guid[] AllParticipantIds);
public sealed record PbeDispute(string Id, Guid OrganizationId, Guid SeasonId, string Activity, string SessionId, string AttemptId, Guid QuestionId, int QuestionVersion, int? Team, string Status, string Reason, long Revision, int[] PartPoints, string SourceEvidence, PbeQuestion Question, string[] Answers, int[] OriginalPointsByPart, DateTimeOffset AcceptedAtUtc, Guid[] ParticipantIds, Guid[] AllParticipantIds, PbeDisputeResolution? Resolution);
