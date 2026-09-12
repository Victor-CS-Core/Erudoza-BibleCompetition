using Erudoza.Domain;
using Erudoza.Domain.Practice;
namespace Erudoza.Application.Abstractions;

public sealed class PbeBankConflictException(string message) : Exception(message);
public sealed record PbeBankScope(Guid OrganizationId, Guid SeasonId, Guid? StudentId, IReadOnlyList<Guid> SourceUnitIds);
public sealed record PbeBank(IReadOnlyList<PbeQuestion> Questions, IReadOnlyList<PbeTarget> Targets, IReadOnlyList<Guid> MissingSourceUnitIds);
public sealed record PbeBankQuestionData(string Id, Guid SeasonId, bool Published, PbeQuestion Question, string SourceFingerprint);
public sealed record PbeSourceScope(IReadOnlyList<SourceUnit> Sources, string Fingerprint);
public interface IPbeQuestionBank
{
    Task<PbeBank> LoadAsync(PbeBankScope scope, CancellationToken ct = default);
    Task<PbeSourceScope> ResolveAsync(Guid organizationId, Guid seasonId, Guid? studentId, CancellationToken ct = default);
}
