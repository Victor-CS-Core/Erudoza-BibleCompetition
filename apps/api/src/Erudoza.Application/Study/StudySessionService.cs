using System.Text.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Application.Competitions;
using Erudoza.Application.Contracts;
using Erudoza.Application.Mapping;
using Erudoza.Domain;
using Erudoza.Domain.Study;
using Microsoft.EntityFrameworkCore;

namespace Erudoza.Application.Study;

public sealed class StudySessionService(
    IErudozaDbContext db,
    IStudyEngine studyEngine,
    IMasteryService mastery,
    IStudentStudyScopeService studyScope,
    IClock clock,
    IStudyWriteCoordinator writes)
{
    private readonly TrainingProgressService training = new(db, studyScope, clock);
    public Task<StudySession> StartAsync(Guid organizationId, Guid studentId, StartSessionRequest request, CancellationToken cancellationToken)
        => writes.ExecuteAsync(studentId, token => StartCoreAsync(organizationId, studentId, request, token), cancellationToken);
    private async Task<StudySession> StartCoreAsync(
        Guid organizationId,
        Guid studentId,
        StartSessionRequest request,
        CancellationToken cancellationToken)
    {
        if (request.Training is { } start)
        {
            var existing = await db.StudySessions.SingleOrDefaultAsync(x => x.OrganizationId == organizationId && x.StudentUserId == studentId && x.ClientStartId == start.ClientStartId, cancellationToken);
            if (existing is not null)
            {
                if (existing.StartPayloadJson != TrainingProgressService.Write(request)) throw new DomainException("This start ID was already used with a different payload.");
                return existing;
            }
        }
        if (request.MemoryChallenge is not (null or "Warmup" or "Advanced")) throw new DomainException("Choose Warmup or Advanced.");
        if (!Enum.IsDefined(request.Mode)) throw new DomainException("Choose Practice, Review, or Simulation.");
        var season = await db.Seasons.Include(item => item.RuleProfile).SingleOrDefaultAsync(
            item => item.Id == request.SeasonId && item.OrganizationId == organizationId,
            cancellationToken) ?? throw new DomainException("Season was not found.");

        DomainInvariants.EnsureSeasonIsActiveForStudy(season);

        var scope = await studyScope.GetAsync(studentId, season.Id, cancellationToken);
        if (scope.EligibleSourceUnitIds.Count == 0)
        {
            throw new DomainException("The student has no assigned study scope.");
        }

        var targetCardCount = request.Mode == StudyMode.Simulation ? 10 : 8;
        if (request.Mode == StudyMode.Review && request.Training?.Step is null)
        {
            var eligibleKnowledgeIds = await db.KnowledgeUnits.AsNoTracking()
                .Where(item => (item.OrganizationId == organizationId && item.ContentPack!.OrganizationId == organizationId || item.OrganizationId == BuiltInLibrary.OrganizationId && item.ContentPack!.OrganizationId == BuiltInLibrary.OrganizationId && item.ContentPack.IsBuiltIn)
                    && item.Kind == KnowledgeUnitKind.ExactVerseText
                    && scope.EligibleSourceUnitIds.Contains(item.SourceUnitId))
                .Select(item => item.Id).ToListAsync(cancellationToken);
            var dueCount = (await db.ReviewSchedules.AsNoTracking()
                .Where(item => item.OrganizationId == organizationId
                    && item.StudentUserId == studentId
                    && item.SeasonId == season.Id)
                .ToListAsync(cancellationToken))
                .Count(item => item.DueAtUtc <= clock.UtcNow && eligibleKnowledgeIds.Contains(item.KnowledgeUnitId));
            if (dueCount == 0)
            {
                throw new DomainException("There are no passages due for review.");
            }

            targetCardCount = Math.Min(8, dueCount);
        }

        var member = await db.CompetitionMembers.AsNoTracking().SingleOrDefaultAsync(
            item => item.OrganizationId == organizationId && item.SeasonId == season.Id
                && item.UserId == studentId, cancellationToken);
        if (request.MemoryChallenge is not null && !season.PbeEnabled) throw new DomainException("Memory study aids are not enabled for this season.");
        if (request.MemoryChallenge == "Advanced" && member?.Difficulty != TrainingDifficulty.Advanced) throw new DomainException("Your coach must set Advanced difficulty before this challenge.");
        var snapshot = RuleProfileReader.Read(season.RuleProfile!);
        if (season.PbeEnabled)
        {
            var purpose = request.MemoryChallenge ?? "Warmup";
            snapshot = snapshot with { MemoryChallenge = purpose, GeneratorVersion = "memory-v3", EvidenceProfile = purpose == "Advanced" ? "memory-honor-v2" : "memory-cued-v3" };
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
            Difficulty = member?.Difficulty ?? TrainingDifficulty.Standard,
            RuleProfileSnapshotJson = JsonSerializer.Serialize(snapshot),
            CreatedAtUtc = clock.UtcNow
        };
        await training.PrepareStartAsync(session, request, cancellationToken);
        db.StudySessions.Add(session);
        await db.SaveChangesAsync(cancellationToken);
        return session;
    }

    public async Task<ChallengeCard> NextAsync(StudyContext context, CancellationToken cancellationToken)
    {
        var result = await writes.ExecuteAsync(context.StudentId, async token => await training.InvalidateStaleAsync(context.OrganizationId, context.StudentId, context.SessionId, token) ? null : await studyEngine.GetNextAsync(context, token), cancellationToken);
        return result ?? throw new TrainingConflictException("The assignment changed. Reload Training HQ.");
    }

    public Task<ResumeSessionDto> ResumeAsync(Guid organizationId, Guid studentId, Guid sessionId,
        bool exposeDebugAnswer, CancellationToken cancellationToken)
        => writes.ExecuteAsync(sessionId, token => ResumeCoreAsync(organizationId, studentId, sessionId, exposeDebugAnswer, token), cancellationToken);

    private async Task<ResumeSessionDto> ResumeCoreAsync(Guid organizationId, Guid studentId, Guid sessionId,
        bool exposeDebugAnswer, CancellationToken cancellationToken)
    {
        var session = await db.StudySessions.Include(item => item.Season).ThenInclude(item => item!.RuleProfile)
            .SingleOrDefaultAsync(item => item.Id == sessionId && item.OrganizationId == organizationId
                && item.StudentUserId == studentId, cancellationToken)
            ?? throw new DomainException("Study session was not found.");
        var latestCard = await db.ChallengeCards.Where(item => item.SessionId == sessionId)
            .OrderByDescending(item => item.Sequence).FirstOrDefaultAsync(cancellationToken);
        ChallengeCardDto? cardDto = null;
        AttemptResultDto? result = null;
        if (latestCard is not null)
        {
            var attempt = await db.Attempts.SingleOrDefaultAsync(item => item.ChallengeCardId == latestCard.Id
                && !item.IsLegacyDuplicate, cancellationToken);
            if (attempt is null && session.Status != StudySessionStatus.Completed)
            {
                DomainInvariants.EnsureSeasonIsActiveForStudy(session.Season!);
                var scope = await studyScope.GetAsync(studentId, session.SeasonId, cancellationToken);
                if (!scope.EligibleSourceUnitIds.Contains(latestCard.SourceUnitId)
                    || !scope.EligibleSourceUnitIds.Contains(latestCard.AnswerSourceUnitId ?? latestCard.SourceUnitId))
                    throw new DomainException("This card is no longer within the student assignment. Start a new session.");
            }
            var source = await db.SourceUnits.SingleAsync(item => item.Id == latestCard.SourceUnitId, cancellationToken);
            var snapshot = RuleProfileReader.ReadSession(session, session.Season!.RuleProfile!);
            cardDto = DtoMapper.ToChallengeCardDto(latestCard, source, session.TargetCardCount, exposeDebugAnswer,
                session.Mode != StudyMode.Simulation || snapshot.ShowReference);
            if (attempt is not null) result = await ToResultAsync(attempt, true, exposeDebugAnswer, cancellationToken);
        }
        SessionSummaryDto? summary = null;
        if (session.Status == StudySessionStatus.Completed)
        {
            var attempts = await db.Attempts.AsNoTracking().Where(item => item.SessionId == sessionId && !item.IsLegacyDuplicate)
                .ToListAsync(cancellationToken);
            summary = new SessionSummaryDto(session.Id, session.Mode.ToString(), attempts.Count,
                attempts.Count(item => item.IsCorrect), session.TargetCardCount, session.Status.ToString(), await training.RecapAsync(session, cancellationToken));
        }
        var memory = RuleProfileReader.ReadSession(session, session.Season!.RuleProfile!);
        return new ResumeSessionDto(new SessionDto(session.Id, session.SeasonId, session.Status.ToString(),
            session.Mode.ToString(), session.TargetCardCount, session.Difficulty.ToString(), memory.MemoryChallenge, memory.GeneratorVersion, memory.EvidenceProfile), cardDto, result, summary);
    }

    public async Task<AttemptResultDto> SubmitAsync(
        Guid organizationId,
        Guid studentId,
        Guid sessionId,
        SubmitAttemptRequest request,
        bool exposeDebugAnswer,
        CancellationToken cancellationToken)
    {
        var result = await writes.ExecuteAsync(studentId, async token =>
        {
            var replay = await db.Attempts.AnyAsync(x => x.SessionId == sessionId && x.OrganizationId == organizationId && x.StudentUserId == studentId && (x.ClientSubmissionId == request.ClientSubmissionId || x.ChallengeCardId == request.ChallengeCardId && !x.IsLegacyDuplicate), token);
            if (!replay && await training.InvalidateStaleAsync(organizationId, studentId, sessionId, token)) return null;
            return await SubmitCoreAsync(organizationId, studentId, sessionId, request, exposeDebugAnswer, token);
        }, cancellationToken);
        return result ?? throw new TrainingConflictException("The assignment changed. Reload Training HQ.");
    }

    private async Task<AttemptResultDto> SubmitCoreAsync(Guid organizationId, Guid studentId, Guid sessionId,
        SubmitAttemptRequest request, bool exposeDebugAnswer, CancellationToken cancellationToken)
    {
        var session = await db.StudySessions.Include(item => item.Season).ThenInclude(item => item!.RuleProfile).SingleOrDefaultAsync(
            item => item.Id == sessionId
                && item.OrganizationId == organizationId
                && item.StudentUserId == studentId,
            cancellationToken) ?? throw new DomainException("Study session was not found.");

        var existing = await db.Attempts.SingleOrDefaultAsync(
            item => item.SessionId == sessionId && item.ClientSubmissionId == request.ClientSubmissionId,
            cancellationToken);

        if (existing is not null)
        {
            if (existing.ChallengeCardId != request.ChallengeCardId
                || existing.SubmittedAnswer != request.SubmittedAnswer
                || existing.ResponseTimeMs != request.ResponseTimeMs
                || existing.HintsUsed != request.HintsUsed)
            {
                throw new DomainException("This submission ID was already used with a different answer payload.");
            }
            return await ToResultAsync(existing, alreadyProcessed: true, exposeDebugAnswer, cancellationToken);
        }

        var answered = await db.Attempts.SingleOrDefaultAsync(
            item => item.SessionId == sessionId && item.ChallengeCardId == request.ChallengeCardId && !item.IsLegacyDuplicate, cancellationToken);
        if (answered is not null)
        {
            return await ToResultAsync(answered, alreadyProcessed: true, exposeDebugAnswer, cancellationToken);
        }
        if (session.Status is StudySessionStatus.Completed or StudySessionStatus.Abandoned)
        {
            throw new DomainException("The study session is already complete.");
        }
        if (request.ResponseTimeMs < 0 || string.IsNullOrWhiteSpace(request.ClientSubmissionId))
        {
            throw new DomainException("A submission ID and non-negative response time are required.");
        }
        if (session.Mode == StudyMode.Simulation && request.HintsUsed)
        {
            throw new DomainException("Hints are not permitted in simulation.");
        }

        var card = await db.ChallengeCards.SingleOrDefaultAsync(
            item => item.Id == request.ChallengeCardId,
            cancellationToken) ?? throw new DomainException("Challenge card was not found.");

        if (card.SessionId != session.Id)
        {
            throw new DomainException("Challenge card does not belong to this session.");
        }

        var cardPayload = ActivitySerialization.ReadPayload(card.PayloadJson);
        RuleProfileReader.ValidateCard(session, session.Season!.RuleProfile!, cardPayload);

        var season = await db.Seasons.SingleAsync(item => item.Id == session.SeasonId, cancellationToken);
        DomainInvariants.EnsureSeasonIsActiveForStudy(season);
        var allowed = await studyScope.GetAsync(studentId, session.SeasonId, cancellationToken);
        if (!allowed.EligibleSourceUnitIds.Contains(card.SourceUnitId)
            || !allowed.EligibleSourceUnitIds.Contains(card.AnswerSourceUnitId ?? card.SourceUnitId))
        {
            throw new DomainException("This card is no longer within the student's available assignment scope.");
        }

        var answerKey = ActivitySerialization.ReadAnswerKey(card.AnswerKeyJson);
        var evaluation = ExactTextEvaluator.Evaluate(request.SubmittedAnswer, answerKey.CanonicalAnswer);

        var preference = await db.TrainingPreferences.AsNoTracking().SingleOrDefaultAsync(x => x.OrganizationId == organizationId && x.StudentUserId == studentId, cancellationToken);
        var acceptedAt = preference is not null && preference.LastEventAtUtc > clock.UtcNow ? preference.LastEventAtUtc : clock.UtcNow;
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
            CreatedAtUtc = acceptedAt
        };

        DomainInvariants.EnsureAttemptBoundaries(attempt, session, card);
        db.Attempts.Add(attempt);

        var priorMastery = await db.MasteryStates.SingleOrDefaultAsync(x => x.OrganizationId == organizationId && x.StudentUserId == studentId && x.SeasonId == session.SeasonId && x.KnowledgeUnitId == card.KnowledgeUnitId, cancellationToken);
        var priorReview = await db.ReviewSchedules.AsNoTracking().SingleOrDefaultAsync(x => x.OrganizationId == organizationId && x.StudentUserId == studentId && x.SeasonId == session.SeasonId && x.KnowledgeUnitId == card.KnowledgeUnitId, cancellationToken);
        var wasDue = priorReview is not null && priorReview.DueAtUtc <= session.CreatedAtUtc;
        attempt.PreviousAttemptId = priorMastery?.LastAttemptId;
        var skillUpdate = await mastery.ApplyAttemptAsync(
            new AttemptEvidence(
                organizationId,
                studentId,
                session.SeasonId,
                card.KnowledgeUnitId,
                evaluation.IsCorrect,
                request.HintsUsed,
                card.ActivityType,
                card.AnswerMode,
                cardPayload.Difficulty, cardPayload.EvidenceProfile),
            cancellationToken);

        if (skillUpdate.Before is not null && skillUpdate.After is not null)
        {
            attempt.BeforeSkillsJson = TrainingProgressService.Write(skillUpdate.Before);
            attempt.AfterSkillsJson = TrainingProgressService.Write(skillUpdate.After);
        }
        await db.SaveChangesAsync(cancellationToken);
        var updatedMastery = await db.MasteryStates.SingleAsync(x => x.OrganizationId == organizationId && x.StudentUserId == studentId && x.SeasonId == session.SeasonId && x.KnowledgeUnitId == card.KnowledgeUnitId, cancellationToken);
        updatedMastery.LastAttemptId = attempt.Id;
        updatedMastery.UpdatedAtUtc = acceptedAt;
        var updatedReview = await db.ReviewSchedules.SingleAsync(x => x.OrganizationId == organizationId && x.StudentUserId == studentId && x.SeasonId == session.SeasonId && x.KnowledgeUnitId == card.KnowledgeUnitId, cancellationToken);
        updatedReview.DueAtUtc = ScaffoldMasteryRules.NextReview(acceptedAt, evaluation.IsCorrect);
        await training.ApplyAsync(session, attempt, cancellationToken, card, wasDue);
        session.Status = StudySessionStatus.Active;
        await db.SaveChangesAsync(cancellationToken);
        var result = await ToResultAsync(attempt, alreadyProcessed: false, exposeDebugAnswer, cancellationToken);
        attempt.ResultJson = JsonSerializer.Serialize(result);
        await db.SaveChangesAsync(cancellationToken);
        return result;
    }

    public Task<SessionSummaryDto> CompleteAsync(Guid organizationId, Guid studentId, Guid sessionId, CancellationToken cancellationToken)
        => writes.ExecuteAsync(studentId, token => CompleteCoreAsync(organizationId, studentId, sessionId, token), cancellationToken);

    private async Task<SessionSummaryDto> CompleteCoreAsync(Guid organizationId, Guid studentId, Guid sessionId, CancellationToken cancellationToken)
    {
        var session = await db.StudySessions.SingleOrDefaultAsync(
            item => item.Id == sessionId && item.OrganizationId == organizationId && item.StudentUserId == studentId,
            cancellationToken) ?? throw new DomainException("Study session was not found.");

        var attempts = await db.Attempts
            .AsNoTracking()
            .Where(item => item.SessionId == sessionId && !item.IsLegacyDuplicate)
            .ToListAsync(cancellationToken);
        if (attempts.Count == 0)
        {
            throw new DomainException("A session cannot be completed without a persisted attempt.");
        }

        session.Status = StudySessionStatus.Completed;
        session.CompletedAtUtc ??= clock.UtcNow;
        session.RecapJson ??= TrainingProgressService.Write(await training.RecapAsync(session, cancellationToken));
        await db.SaveChangesAsync(cancellationToken);
        return new SessionSummaryDto(
            session.Id,
            session.Mode.ToString(),
            attempts.Count,
            attempts.Count(item => item.IsCorrect),
            session.TargetCardCount,
            session.Status.ToString(), TrainingProgressService.Read<SessionRecapDto>(session.RecapJson));
    }

    private async Task<AttemptResultDto> ToResultAsync(
        Attempt attempt,
        bool alreadyProcessed,
        bool exposeDebugAnswer,
        CancellationToken cancellationToken)
    {
        if (!string.IsNullOrWhiteSpace(attempt.ResultJson))
        {
            var saved = JsonSerializer.Deserialize<AttemptResultDto>(attempt.ResultJson);
            if (saved is not null) return saved with { AlreadyProcessed = alreadyProcessed };
        }
        var card = await db.ChallengeCards.SingleAsync(item => item.Id == attempt.ChallengeCardId, cancellationToken);
        var source = await db.SourceUnits.SingleAsync(item => item.Id == (card.AnswerSourceUnitId ?? card.SourceUnitId), cancellationToken);
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

        var result = new AttemptResultDto(
            attempt.Id,
            attempt.IsCorrect,
            attempt.EvaluationResult,
            answerKey.CanonicalAnswer,
            source.CitationLabel,
            source.CanonicalText,
            masteryState?.Level.ToString() ?? MasteryLevel.Learning.ToString(),
            masteryState?.ExactWordingScore ?? 0,
            review?.DueAtUtc,
            alreadyProcessed);
        // Legacy attempts have no original response snapshot. Freeze the first rebuilt
        // response on replay; the coordinator persists it without applying mastery.
        attempt.ResultJson = JsonSerializer.Serialize(result with { AlreadyProcessed = false });
        return result;
    }
}
