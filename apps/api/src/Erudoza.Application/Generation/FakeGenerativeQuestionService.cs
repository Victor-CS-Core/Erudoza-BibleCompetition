using Erudoza.Application.Abstractions;
using Erudoza.Domain;
using Microsoft.EntityFrameworkCore;

namespace Erudoza.Application.Generation;

public sealed class FakeGenerativeQuestionService(IErudozaDbContext db) : IGenerativeQuestionService
{
    public async Task<QuestionCandidateData> GenerateAsync(
        QuestionGenerationContext context,
        CancellationToken cancellationToken)
    {
        var unit = await db.SourceUnits.AsNoTracking()
            .Where(item => item.OrganizationId == context.OrganizationId && context.SourceUnitIds.Contains(item.Id))
            .OrderBy(item => item.Ordinal)
            .FirstAsync(cancellationToken);

        return new QuestionCandidateData(
            "1",
            "ShortFact",
            $"According to {unit.CitationLabel}, which development sample place is named first?",
            nameof(AnswerMode.ShortFact),
            "city",
            ["city"],
            [new QuestionEvidenceItem(unit.Id, unit.CanonicalText)],
            2,
            "Deterministic fake candidate for tests and degraded development.",
            "fake-generative-v1");
    }
}
