using Erudoza.Application.Abstractions;
using Erudoza.Domain;
using Erudoza.Domain.Study;
using Microsoft.EntityFrameworkCore;

namespace Erudoza.Application.Study;

public sealed class MasteryService(IErudozaDbContext db, IClock clock) : IMasteryService
{
    public async Task<MasteryUpdateResult> ApplyAttemptAsync(
        AttemptEvidence attempt,
        CancellationToken cancellationToken)
    {
        var state = await db.MasteryStates.SingleOrDefaultAsync(
            item => item.OrganizationId == attempt.OrganizationId
                && item.StudentUserId == attempt.StudentUserId
                && item.SeasonId == attempt.SeasonId
                && item.KnowledgeUnitId == attempt.KnowledgeUnitId,
            cancellationToken);

        if (state is null)
        {
            state = new MasteryState
            {
                Id = Guid.NewGuid(),
                OrganizationId = attempt.OrganizationId,
                StudentUserId = attempt.StudentUserId,
                SeasonId = attempt.SeasonId,
                KnowledgeUnitId = attempt.KnowledgeUnitId,
                AlgorithmVersion = ScaffoldMasteryRules.AlgorithmVersion,
                UpdatedAtUtc = clock.UtcNow
            };
            db.MasteryStates.Add(state);
        }

        var updated = ScaffoldMasteryRules.Apply(
            new MasteryScores(
                state.RecognitionScore,
                state.ExactWordingScore,
                state.ReferenceScore,
                state.SequenceScore,
                state.FactualRecallScore,
                state.Level),
            attempt.IsCorrect,
            attempt.HintsUsed,
            attempt.ActivityType);

        state.RecognitionScore = updated.Recognition;
        state.ExactWordingScore = updated.ExactWording;
        state.ReferenceScore = updated.Reference;
        state.SequenceScore = updated.Sequence;
        state.FactualRecallScore = updated.FactualRecall;
        state.Level = updated.Level;
        state.AlgorithmVersion = ScaffoldMasteryRules.AlgorithmVersion;
        state.UpdatedAtUtc = clock.UtcNow;

        var review = await db.ReviewSchedules.SingleOrDefaultAsync(
            item => item.OrganizationId == attempt.OrganizationId
                && item.StudentUserId == attempt.StudentUserId
                && item.SeasonId == attempt.SeasonId
                && item.KnowledgeUnitId == attempt.KnowledgeUnitId,
            cancellationToken);

        var due = ScaffoldMasteryRules.NextReview(clock.UtcNow, attempt.IsCorrect);
        if (review is null)
        {
            review = new ReviewSchedule
            {
                Id = Guid.NewGuid(),
                OrganizationId = attempt.OrganizationId,
                StudentUserId = attempt.StudentUserId,
                SeasonId = attempt.SeasonId,
                KnowledgeUnitId = attempt.KnowledgeUnitId,
                DueAtUtc = due,
                AlgorithmVersion = ScaffoldMasteryRules.AlgorithmVersion
            };
            db.ReviewSchedules.Add(review);
        }
        else
        {
            review.DueAtUtc = due;
            review.AlgorithmVersion = ScaffoldMasteryRules.AlgorithmVersion;
        }

        return new MasteryUpdateResult(
            state.Level,
            state.ExactWordingScore,
            state.RecognitionScore,
            review.DueAtUtc,
            ScaffoldMasteryRules.AlgorithmVersion);
    }
}
