using System.Text.Json;
using Erudoza.Application.Study;
namespace Erudoza.Application.Abstractions;

public sealed record CooperationInput(string Key, JsonElement Value);
public sealed record CooperationFact(string StudentId, string SourceKind, string ContentPackId, string SourceUnitId,
    bool? QuestionCovered, bool? Practiced, bool? Recalled, bool? Retained, bool DueKnown, bool? Unresolved, long? ScheduledAtMs);
public sealed record CooperationMaterialRow(string StudentId, string SourceKind, int Assigned, int CoveredKnown, int CoveredPossible,
    int PracticedKnown, int PracticedPossible, int RetainedKnown, int RetainedPossible, int DueKnown, int DuePossible, long? FutureDueAtMs);
public interface IPbeCooperationReader
{
    Task<IReadOnlyList<CooperationInput>> SourcePage(VerifiedCooperationScope scope, string after, CancellationToken ct);
    Task<IReadOnlyList<CooperationInput>> InputPage(VerifiedCooperationScope scope, string generation, string after, CancellationToken ct);
    Task<string?> LimitReason(VerifiedCooperationScope scope, CancellationToken ct);
    Task<bool> InputsCurrent(VerifiedCooperationScope scope, string generation, CancellationToken ct);
    Task<IReadOnlyList<CooperationFact>> FactPage(VerifiedCooperationScope scope, string generation, string after, CancellationToken ct);
    Task<IReadOnlyList<CooperationInput>> Descriptors(VerifiedCooperationScope scope, string generation, CancellationToken ct);
    Task<IReadOnlyList<CooperationMaterialRow>> Totals(VerifiedCooperationScope scope, string generation, long checkedAtMs, CancellationToken ct);
    Task<string> ScopeVersion(VerifiedCooperationScope scope, string generation, CancellationToken ct);
}
