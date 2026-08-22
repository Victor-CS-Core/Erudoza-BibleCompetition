using System.Text.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Domain;

namespace Erudoza.Application.Generation;

public sealed class QuestionLifecycleService(
    IErudozaDbContext db,
    IQuestionCandidateValidator validator,
    IClock clock) : IQuestionLifecycleService
{
    public async Task<Guid> PromoteValidatedCandidateAsync(
        QuestionCandidateData candidate,
        QuestionValidationContext context,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(candidate, context, cancellationToken);
        if (!validation.IsValid)
        {
            throw new DomainException("Generated questions cannot become playable until validation succeeds.");
        }

        var entity = new QuestionCandidate
        {
            Id = Guid.NewGuid(),
            OrganizationId = context.OrganizationId,
            SeasonId = context.SeasonId,
            SchemaVersion = candidate.SchemaVersion,
            QuestionType = candidate.QuestionType,
            Prompt = candidate.Prompt,
            AnswerMode = Enum.Parse<AnswerMode>(candidate.AnswerMode, true),
            CanonicalAnswer = candidate.CanonicalAnswer,
            AcceptedAnswersJson = JsonSerializer.Serialize(candidate.AcceptedAnswers),
            Difficulty = candidate.Difficulty,
            Explanation = candidate.Explanation,
            GeneratorVersion = candidate.GeneratorVersion,
            Status = QuestionLifecycleStatus.Playable,
            CreatedAtUtc = clock.UtcNow
        };

        db.QuestionCandidates.Add(entity);
        foreach (var evidence in candidate.SourceEvidence)
        {
            db.QuestionEvidence.Add(new QuestionEvidence
            {
                Id = Guid.NewGuid(),
                QuestionCandidateId = entity.Id,
                SourceUnitId = evidence.SourceUnitId,
                EvidenceText = evidence.EvidenceText
            });
        }

        var packId = await ResolvePackId(candidate, cancellationToken);
        var playable = new PlayableQuestion
        {
            Id = Guid.NewGuid(),
            OrganizationId = context.OrganizationId,
            QuestionCandidateId = entity.Id,
            ContentPackId = packId,
            Status = QuestionLifecycleStatus.Playable,
            CreatedAtUtc = clock.UtcNow
        };
        db.PlayableQuestions.Add(playable);
        await db.SaveChangesAsync(cancellationToken);
        return playable.Id;
    }

    private async Task<Guid> ResolvePackId(QuestionCandidateData candidate, CancellationToken cancellationToken)
    {
        var sourceId = candidate.SourceEvidence[0].SourceUnitId;
        var unit = await db.SourceUnits.FindAsync([sourceId], cancellationToken)
            ?? throw new DomainException("Source unit was not found.");
        return unit.ContentPackId;
    }
}
