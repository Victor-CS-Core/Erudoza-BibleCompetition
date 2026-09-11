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

        var priorScores = new MasteryScores(
                state.RecognitionScore,
                state.ExactWordingScore,
                state.ReferenceScore,
                state.SequenceScore,
                state.FactualRecallScore,
                state.Level);
        if (state.AlgorithmVersion != ScaffoldMasteryRules.AlgorithmVersion)
        {
            // Historic scaffold totals included recognition as exact recall. Rebuild from
            // persisted evidence on first new attempt, preserving the original attempts.
            priorScores = new MasteryScores(0, 0, 0, 0, 0, MasteryLevel.Unseen);
            var history = await db.Attempts.AsNoTracking().Include(item => item.ChallengeCard)
                .Where(item => item.OrganizationId == attempt.OrganizationId
                    && item.StudentUserId == attempt.StudentUserId && item.SeasonId == attempt.SeasonId
                    && item.KnowledgeUnitId == attempt.KnowledgeUnitId && !item.IsLegacyDuplicate).ToListAsync(cancellationToken);
            foreach (var evidence in history.OrderBy(item => item.CreatedAtUtc).ThenBy(item => item.Id))
            {
                // Old sequence cards identified the prompt as the scoring target.
                // Preserve that record, but do not infer answer evidence it never stored.
                if (evidence.ActivityType == "WhatComesNext" && evidence.ChallengeCard?.AnswerSourceUnitId is null)
                    continue;
                priorScores = ScaffoldMasteryRules.Apply(priorScores, evidence.IsCorrect, evidence.HintsUsed,
                    evidence.ActivityType, evidence.ChallengeCard?.AnswerMode ?? AnswerMode.SelectedChoice,
                    evidence.ChallengeCard is { } historicalCard ? ActivitySerialization.ReadPayload(historicalCard.PayloadJson).Difficulty : 1);
            }
        }
        var updated = ScaffoldMasteryRules.Apply(priorScores,
            attempt.IsCorrect,
            attempt.HintsUsed,
            attempt.ActivityType,
            attempt.AnswerMode,
            attempt.Difficulty);

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
