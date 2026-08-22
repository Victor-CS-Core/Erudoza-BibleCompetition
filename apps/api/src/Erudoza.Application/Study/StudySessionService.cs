using Erudoza.Application.Abstractions;
using Erudoza.Application.Contracts;
using Erudoza.Domain;
using Erudoza.Domain.Study;
using Microsoft.EntityFrameworkCore;

namespace Erudoza.Application.Study;

public sealed class StudySessionService(
    IErudozaDbContext db,
    IStudyEngine studyEngine,
    IMasteryService mastery,
    IStudentStudyScopeService studyScope,
    IClock clock)
{
    public async Task<StudySession> StartAsync(
        Guid organizationId,
        Guid studentId,
        StartSessionRequest request,
        CancellationToken cancellationToken)
    {
        var season = await db.Seasons.SingleOrDefaultAsync(
            item => item.Id == request.SeasonId && item.OrganizationId == organizationId,
            cancellationToken) ?? throw new DomainException("Season was not found.");

        DomainInvariants.EnsureSeasonIsActiveForStudy(season);

        var scope = await studyScope.GetAsync(studentId, season.Id, cancellationToken);
        if (scope.EligibleSourceUnitIds.Count == 0)
        {
            throw new DomainException("The student has no assigned study scope.");
        }

        var targetCardCount = request.Mode == StudyMode.Simulation ? 10 : 8;
        if (request.Mode == StudyMode.Review)
        {
            var dueCount = (await db.ReviewSchedules.AsNoTracking()
                .Where(item => item.OrganizationId == organizationId
                    && item.StudentUserId == studentId
                    && item.SeasonId == season.Id)
                .ToListAsync(cancellationToken))
                .Count(item => item.DueAtUtc <= clock.UtcNow);
            if (dueCount == 0)
            {
                throw new DomainException("There are no passages due for review.");
            }

            targetCardCount = Math.Min(8, dueCount);
        }

        var session = new StudySession
        {
            Id = Guid.NewGuid(),
            OrganizationId = organizationId,
            SeasonId = season.Id,
            StudentUserId = studentId,
            Mode = request.Mode,
            Status = StudySessionStatus.Created,
            TargetCardCount = targetCardCount,
            CreatedAtUtc = clock.UtcNow
        };
        db.StudySessions.Add(session);
        await db.SaveChangesAsync(cancellationToken);
        return session;
    }

    public Task<ChallengeCard> NextAsync(StudyContext context, CancellationToken cancellationToken) =>
        studyEngine.GetNextAsync(context, cancellationToken);

    public async Task<AttemptResultDto> SubmitAsync(
        Guid organizationId,
        Guid studentId,
        Guid sessionId,
        SubmitAttemptRequest request,
        bool exposeDebugAnswer,
        CancellationToken cancellationToken)
    {
        var session = await db.StudySessions.SingleOrDefaultAsync(
            item => item.Id == sessionId
                && item.OrganizationId == organizationId
                && item.StudentUserId == studentId,
            cancellationToken) ?? throw new DomainException("Study session was not found.");

        var existing = await db.Attempts.SingleOrDefaultAsync(
            item => item.SessionId == sessionId && item.ClientSubmissionId == request.ClientSubmissionId,
            cancellationToken);

        if (existing is not null)
        {
            return await ToResultAsync(existing, alreadyProcessed: true, exposeDebugAnswer, cancellationToken);
        }

        var card = await db.ChallengeCards.SingleOrDefaultAsync(
            item => item.Id == request.ChallengeCardId,
            cancellationToken) ?? throw new DomainException("Challenge card was not found.");

        if (card.SessionId != session.Id)
        {
            throw new DomainException("Challenge card does not belong to this session.");
        }

        var answerKey = ActivitySerialization.ReadAnswerKey(card.AnswerKeyJson);
        var evaluation = ExactTextEvaluator.Evaluate(request.SubmittedAnswer, answerKey.CanonicalAnswer);

        var attempt = new Attempt
        {
            Id = Guid.NewGuid(),
            OrganizationId = organizationId,
            SessionId = session.Id,
            ChallengeCardId = card.Id,
            StudentUserId = studentId,
            SeasonId = session.SeasonId,
            KnowledgeUnitId = card.KnowledgeUnitId,
            ClientSubmissionId = request.ClientSubmissionId,
            SubmittedAnswer = request.SubmittedAnswer,
            NormalizedAnswer = evaluation.NormalizedSubmitted,
            IsCorrect = evaluation.IsCorrect,
            EvaluationResult = evaluation.EvaluationCode,
            EvaluatorVersion = evaluation.EvaluatorVersion,
            ResponseTimeMs = request.ResponseTimeMs,
            HintsUsed = request.HintsUsed,
            ActivityType = card.ActivityType,
            CreatedAtUtc = clock.UtcNow
        };

        DomainInvariants.EnsureAttemptBoundaries(attempt, session, card);
        db.Attempts.Add(attempt);

        await mastery.ApplyAttemptAsync(
            new AttemptEvidence(
                organizationId,
                studentId,
                session.SeasonId,
                card.KnowledgeUnitId,
                evaluation.IsCorrect,
                request.HintsUsed,
                card.ActivityType,
                card.AnswerMode),
            cancellationToken);

        session.Status = StudySessionStatus.Active;
        await db.SaveChangesAsync(cancellationToken);
        return await ToResultAsync(attempt, alreadyProcessed: false, exposeDebugAnswer, cancellationToken);
    }

    public async Task<SessionSummaryDto> CompleteAsync(Guid organizationId, Guid studentId, Guid sessionId, CancellationToken cancellationToken)
    {
        var session = await db.StudySessions.SingleOrDefaultAsync(
            item => item.Id == sessionId && item.OrganizationId == organizationId && item.StudentUserId == studentId,
            cancellationToken) ?? throw new DomainException("Study session was not found.");

        var attempts = await db.Attempts
            .AsNoTracking()
            .Where(item => item.SessionId == sessionId)
            .ToListAsync(cancellationToken);
        if (attempts.Count == 0)
        {
            throw new DomainException("A session cannot be completed without a persisted attempt.");
        }

        session.Status = StudySessionStatus.Completed;
        session.CompletedAtUtc = clock.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        return new SessionSummaryDto(
            session.Id,
            session.Mode.ToString(),
            attempts.Count,
            attempts.Count(item => item.IsCorrect),
            session.TargetCardCount,
            session.Status.ToString());
    }

    private async Task<AttemptResultDto> ToResultAsync(
        Attempt attempt,
        bool alreadyProcessed,
        bool exposeDebugAnswer,
        CancellationToken cancellationToken)
    {
        var card = await db.ChallengeCards.SingleAsync(item => item.Id == attempt.ChallengeCardId, cancellationToken);
        var source = await db.SourceUnits.SingleAsync(item => item.Id == card.SourceUnitId, cancellationToken);
        var masteryState = await db.MasteryStates.SingleOrDefaultAsync(
            item => item.StudentUserId == attempt.StudentUserId
                && item.SeasonId == attempt.SeasonId
                && item.KnowledgeUnitId == card.KnowledgeUnitId,
            cancellationToken);
        var review = await db.ReviewSchedules.SingleOrDefaultAsync(
            item => item.StudentUserId == attempt.StudentUserId
                && item.SeasonId == attempt.SeasonId
                && item.KnowledgeUnitId == card.KnowledgeUnitId,
            cancellationToken);
        var answerKey = ActivitySerialization.ReadAnswerKey(card.AnswerKeyJson);

        return new AttemptResultDto(
            attempt.Id,
            attempt.IsCorrect,
            attempt.EvaluationResult,
            exposeDebugAnswer ? answerKey?.CanonicalAnswer ?? string.Empty : answerKey?.CanonicalAnswer ?? string.Empty,
            source.CitationLabel,
            source.CanonicalText,
            masteryState?.Level.ToString() ?? MasteryLevel.Learning.ToString(),
            masteryState?.ExactWordingScore ?? 0,
            review?.DueAtUtc,
            alreadyProcessed);
    }
}
