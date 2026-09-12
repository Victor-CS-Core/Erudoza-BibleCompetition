using Erudoza.Domain;
namespace Erudoza.Application.Abstractions;

public sealed record PbeFrozenMetadata(string AttemptId, Guid QuestionId, int? QuestionVersion, long? ResponseLockedAtMs, IReadOnlyList<Guid> TargetIds);
public sealed record PbeReplayTargetState(Guid TargetId, bool NeedsReplay, bool HasProjection, bool HasEvidence);
public interface IPbeChapterJsonReader
{
    Task<IReadOnlyList<PbeSourceUnit>> IntroductionPage(Guid org, Guid season, Guid student, string after, int limit, CancellationToken ct);
    Task<IReadOnlyList<PbeSourceUnit>> SelectedIntroductionSources(Guid org, Guid season, Guid student, IReadOnlyList<string> ids, CancellationToken ct);
    Task<IReadOnlyList<PbeTrainingRecord>> AssignedIntroductionPage(Guid org, Guid season, Guid student, string after, int limit, CancellationToken ct);
    Task<IReadOnlyList<PbeTrainingRecord>> CandidatePage(Guid org, Guid season, Guid student, string generation, string kind, string after, int limit, CancellationToken ct);
    Task<IReadOnlyList<string>> ManifestEntries(Guid org, Guid season, Guid student, string generation, string family, IReadOnlyList<string>? ids, CancellationToken ct);
    Task<IReadOnlyList<PbeTrainingRecord>> LegacyEventPage(Guid org, Guid season, Guid student, string after, CancellationToken ct);
    Task<IReadOnlyList<PbeReplayTargetState>> ReplayStates(Guid org, Guid season, Guid student, IReadOnlyList<Guid> targets, CancellationToken ct);
    Task<IReadOnlyList<PbeTrainingRecord>> CurrentRetentionPage(Guid org, Guid season, Guid student, string generation, string after, CancellationToken ct);
    Task<IReadOnlyList<PbeTrainingRecord>> CurrentRetentions(Guid org, Guid season, Guid student, string generation, CancellationToken ct);
    Task<IReadOnlyList<PbeFrozenMetadata>> FrozenMetadata(Guid org, Guid season, Guid student, IReadOnlyList<string> attemptIds, CancellationToken ct);
}
