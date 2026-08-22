using Erudoza.Application.Abstractions;
using Erudoza.Domain;
using Microsoft.EntityFrameworkCore;

namespace Erudoza.Application.Generation;

public sealed class QuestionCandidateValidator(IErudozaDbContext db) : IQuestionCandidateValidator
{
    public async Task<QuestionValidationResult> ValidateAsync(
        QuestionCandidateData candidate,
        QuestionValidationContext context,
        CancellationToken cancellationToken)
    {
        var errors = new List<string>();
        if (string.IsNullOrWhiteSpace(candidate.Prompt)
            || string.IsNullOrWhiteSpace(candidate.CanonicalAnswer)
            || candidate.SourceEvidence.Count == 0)
        {
            errors.Add("Required candidate fields are missing.");
        }

        if (candidate.AcceptedAnswers.Distinct(StringComparer.OrdinalIgnoreCase).Count() != candidate.AcceptedAnswers.Count)
        {
            errors.Add("Answer choices duplicate each other.");
        }

        foreach (var evidence in candidate.SourceEvidence)
        {
            if (!context.AllowedSourceUnitIds.Contains(evidence.SourceUnitId))
            {
                errors.Add("Source ID is outside season scope.");
                continue;
            }

            var unit = await db.SourceUnits.AsNoTracking().SingleOrDefaultAsync(
                item => item.Id == evidence.SourceUnitId && item.OrganizationId == context.OrganizationId,
                cancellationToken);

            if (unit is null)
            {
                errors.Add("Evidence cites an unknown source unit.");
                continue;
            }

            if (unit.IsRetired || !unit.IsActive)
            {
                errors.Add("A referenced content version is stale.");
            }

            var expected = TextNormalization.Normalize(unit.CanonicalText, NormalizationProfile.ExactText);
            var provided = TextNormalization.Normalize(evidence.EvidenceText, NormalizationProfile.ExactText);
            if (!string.Equals(expected, provided, StringComparison.Ordinal)
                && !unit.CanonicalText.Contains(evidence.EvidenceText, StringComparison.Ordinal))
            {
                errors.Add("Evidence text does not match the stored source.");
            }
        }

        return errors.Count == 0
            ? QuestionValidationResult.Success()
            : QuestionValidationResult.Failure([.. errors]);
    }
}
