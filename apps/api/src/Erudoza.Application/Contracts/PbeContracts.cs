namespace Erudoza.Application.Contracts;

public sealed record PbeQuestionView(
    Guid Id,
    int Version,
    string Prompt,
    string Reference,
    string Kind,
    IReadOnlyList<int> PartPoints,
    int Points,
    int DurationSeconds);

public sealed record PbeIntroductionDto(Guid Id, Guid OrganizationId, Guid SeasonId, string BookKey, string SourceEdition, string Title, string Citation, string LicensingStatus, bool Reviewed, IReadOnlyList<Erudoza.Domain.PbeIntroductionUnit> Units, long Revision, IReadOnlyList<Guid> AssignedStudentIds);
