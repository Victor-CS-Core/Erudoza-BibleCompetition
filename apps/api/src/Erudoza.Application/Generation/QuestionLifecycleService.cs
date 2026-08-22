using System.Text.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Domain;
using Microsoft.EntityFrameworkCore;

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

    public async Task<Guid> ApproveStoredCandidateAsync(
        Guid organizationId,
        Guid candidateId,
        CancellationToken cancellationToken)
    {
        var entity = await db.QuestionCandidates
            .Include(item => item.Evidence)
            .SingleOrDefaultAsync(item => item.Id == candidateId && item.OrganizationId == organizationId, cancellationToken)
            ?? throw new DomainException("Question candidate was not found.");

        var existing = await db.PlayableQuestions.SingleOrDefaultAsync(
            item => item.QuestionCandidateId == entity.Id && item.OrganizationId == organizationId,
            cancellationToken);
        if (existing is not null)
        {
            return existing.Id;
        }

        var accepted = JsonSerializer.Deserialize<List<string>>(entity.AcceptedAnswersJson) ?? [];
        var data = new QuestionCandidateData(
            entity.SchemaVersion,
            entity.QuestionType,
            entity.Prompt,
            entity.AnswerMode.ToString(),
            entity.CanonicalAnswer,
            accepted,
            entity.Evidence.Select(item => new QuestionEvidenceItem(item.SourceUnitId, item.EvidenceText)).ToList(),
            entity.Difficulty,
            entity.Explanation,
            entity.GeneratorVersion);
        var allowed = entity.Evidence.Select(item => item.SourceUnitId).ToHashSet();
        var validation = await validator.ValidateAsync(
            data,
            new QuestionValidationContext(organizationId, entity.SeasonId ?? Guid.Empty, allowed),
            cancellationToken);
        if (!validation.IsValid)
        {
            throw new DomainException("Generated questions cannot become playable until validation succeeds.");
        }

        entity.Status = QuestionLifecycleStatus.Playable;
        var packId = await ResolvePackId(data, cancellationToken);
        var playable = new PlayableQuestion
        {
            Id = Guid.NewGuid(),
            OrganizationId = organizationId,
            QuestionCandidateId = entity.Id,
            ContentPackId = packId,
            Status = QuestionLifecycleStatus.Playable,
            CreatedAtUtc = clock.UtcNow
        };
        db.PlayableQuestions.Add(playable);
        await db.SaveChangesAsync(cancellationToken);
        return playable.Id;
    }

    public async Task RejectStoredCandidateAsync(
        Guid organizationId,
        Guid candidateId,
        CancellationToken cancellationToken)
    {
        var entity = await db.QuestionCandidates.SingleOrDefaultAsync(
            item => item.Id == candidateId && item.OrganizationId == organizationId,
            cancellationToken) ?? throw new DomainException("Question candidate was not found.");

        if (entity.Status == QuestionLifecycleStatus.Playable)
        {
            throw new DomainException("A playable question cannot be rejected.");
        }

        entity.Status = QuestionLifecycleStatus.Rejected;
        await db.SaveChangesAsync(cancellationToken);
    }

    private async Task<Guid> ResolvePackId(QuestionCandidateData candidate, CancellationToken cancellationToken)
    {
        var sourceId = candidate.SourceEvidence[0].SourceUnitId;
        var unit = await db.SourceUnits.FindAsync([sourceId], cancellationToken)
            ?? throw new DomainException("Source unit was not found.");
        return unit.ContentPackId;
    }
}
