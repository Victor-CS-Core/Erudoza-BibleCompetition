using Erudoza.Domain;
using Erudoza.Domain.Practice;
namespace Erudoza.Application.Abstractions;

public sealed class PbeBankConflictException(string message) : Exception(message);
public sealed record PbeBankScope(Guid OrganizationId, Guid SeasonId, Guid? StudentId, IReadOnlyList<Guid> SourceUnitIds);
public sealed record PbeBank(IReadOnlyList<PbeQuestion> Questions, IReadOnlyList<PbeTarget> Targets, IReadOnlyList<Guid> MissingSourceUnitIds);
public sealed record PbeBankQuestionData(string Id, Guid SeasonId, bool Published, PbeQuestion Question, string SourceFingerprint);
public sealed record PbeSourceScope(IReadOnlyList<PbeSourceUnit> Sources, string Fingerprint);
public sealed record PbeSourceUnit(Guid Id, Guid ContentPackId, PbeSourceKind SourceKind, string BookKey, int? Chapter, int? Verse, int Ordinal, string CitationLabel, string CanonicalText)
{
    public static PbeSourceUnit FromLegacy(SourceUnit s) => new(s.Id, s.ContentPackId, s.ContentPack?.SourceType == SourceType.Supplemental ? PbeSourceKind.Commentary : PbeSourceKind.Scripture, s.BookKey, s.Chapter, s.Verse, s.Ordinal, s.CitationLabel, s.CanonicalText);
}
public interface IPbeQuestionBank
{
    Task<PbeBank> LoadAsync(PbeBankScope scope, CancellationToken ct = default);
    Task<PbeSourceScope> ResolveAsync(Guid organizationId, Guid seasonId, Guid? studentId, CancellationToken ct = default);
}
