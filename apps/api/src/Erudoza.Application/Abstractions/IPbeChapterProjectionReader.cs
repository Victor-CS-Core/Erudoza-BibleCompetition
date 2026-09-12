using Erudoza.Application.Study;
using Erudoza.Domain.Practice;
namespace Erudoza.Application.Abstractions;

public sealed record PbeChapterGroupMetadata(string Key, string? ParentChapterKey, string Kind,
    Guid ContentPackId, string BookKey, int? Chapter, int AssignedPassages,
    string Label, string ScopeLabel, string SortKey);
public sealed record PbeCapturedRetention(Guid TargetId, PbeReviewProjection Projection, long Revision);
public interface IPbeChapterProjectionReader
{
    Task<IReadOnlyList<PbeChapterGroupMetadata>> GroupPage(Guid org, Guid season, Guid student, string generation, string after, CancellationToken ct);
    Task<IReadOnlyList<PbeTarget>> GroupTargets(Guid org, Guid season, Guid student, string generation, string groupKey, string after, CancellationToken ct);
    Task<int> CoveredPassages(Guid org, Guid season, Guid student, string generation, string groupKey, CancellationToken ct);
    Task<IReadOnlyDictionary<Guid, int>> VariantCounts(Guid org, Guid season, Guid student, string generation, IReadOnlyList<PbeTarget> targets, CancellationToken ct);
    Task<IReadOnlyList<Guid>> TargetIds(Guid org, Guid season, Guid student, string generation, string after, CancellationToken ct);
    Task<IReadOnlyList<PbeCapturedRetention>> RetentionPage(Guid org, Guid season, Guid student, string generation, IReadOnlyList<Guid> targetIds, CancellationToken ct);
    Task<IReadOnlyList<PbeCapturedRetention>> Retentions(Guid org, Guid season, Guid student, string generation, IReadOnlyList<Guid> targetIds, CancellationToken ct);
}
