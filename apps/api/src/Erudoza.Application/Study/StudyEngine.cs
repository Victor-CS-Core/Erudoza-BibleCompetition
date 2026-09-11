using Erudoza.Application.Abstractions;
using Erudoza.Application.Competitions;
using Erudoza.Domain;
using Erudoza.Domain.Study;
using Microsoft.EntityFrameworkCore;

namespace Erudoza.Application.Study;

public sealed class StudyEngine(
    IErudozaDbContext db,
    IStudentStudyScopeService studyScope,
    IReadOnlyList<IActivityProvider> providers, IClock? clock = null) : IStudyEngine
{
    public async Task<ChallengeCard> GetNextAsync(StudyContext context, CancellationToken cancellationToken)
    {
        var session = await db.StudySessions
            .Include(item => item.Cards)
            .SingleOrDefaultAsync(
                item => item.Id == context.SessionId
                    && item.OrganizationId == context.OrganizationId
                    && item.StudentUserId == context.StudentId
                    && item.SeasonId == context.SeasonId,
                cancellationToken) ?? throw new DomainException("Study session was not found.");

        var season = await db.Seasons
            .Include(item => item.RuleProfile)
            .SingleAsync(item => item.Id == context.SeasonId && item.OrganizationId == context.OrganizationId, cancellationToken);

        DomainInvariants.EnsureSeasonIsActiveForStudy(season);

        if (session.Status == StudySessionStatus.Completed)
        {
            throw new DomainException("The study session is already complete.");
        }

        var scope = await studyScope.GetAsync(context.StudentId, context.SeasonId, cancellationToken);
        if (scope.EligibleSourceUnitIds.Count == 0)
        {
            throw new DomainException("The student has no assigned study scope.");
        }

        var answeredCardIds = await db.Attempts
            .AsNoTracking()
            .Where(attempt => attempt.SessionId == session.Id)
            .Select(attempt => attempt.ChallengeCardId)
            .ToListAsync(cancellationToken);
        var unanswered = session.Cards
            .OrderBy(card => card.Sequence)
            .FirstOrDefault(card => !answeredCardIds.Contains(card.Id));

        if (unanswered is not null)
        {
            if (!scope.EligibleSourceUnitIds.Contains(unanswered.SourceUnitId)
                || (unanswered.AnswerSourceUnitId is { } answerSourceId && !scope.EligibleSourceUnitIds.Contains(answerSourceId)))
                throw new DomainException("This card is no longer within the student assignment. Start a new session.");
            return unanswered;
        }

        if (session.Cards.Count >= session.TargetCardCount)
        {
            throw new DomainException("The session target has been reached.");
        }

        var exposure = await db.ChallengeCards.AsNoTracking()
            .Where(card => card.OrganizationId == context.OrganizationId
                && card.StudentUserId == context.StudentId && card.SeasonId == context.SeasonId)
            .Select(card => new { card.SourceUnitId, card.CreatedAtUtc })
            .ToListAsync(cancellationToken);
        var now = clock?.UtcNow ?? DateTimeOffset.UtcNow;
        var due = (await db.ReviewSchedules
            .AsNoTracking()
            .Where(item => item.OrganizationId == context.OrganizationId
                && item.StudentUserId == context.StudentId
                && item.SeasonId == context.SeasonId)
            .ToListAsync(cancellationToken))
            .Where(item => item.DueAtUtc <= now)
            .Select(item => item.KnowledgeUnitId)
            .ToList();

        var knowledgeUnits = await db.KnowledgeUnits
            .Include(item => item.SourceUnit)
            .Where(item => (item.OrganizationId == context.OrganizationId && item.ContentPack!.OrganizationId == context.OrganizationId || item.OrganizationId == BuiltInLibrary.OrganizationId && item.ContentPack!.OrganizationId == BuiltInLibrary.OrganizationId && item.ContentPack.IsBuiltIn)
                && scope.EligibleSourceUnitIds.Contains(item.SourceUnitId)
                && item.Kind == KnowledgeUnitKind.ExactVerseText
                && item.SourceUnit != null && item.SourceUnit.IsActive && !item.SourceUnit.IsRetired
                && item.SourceUnit.OrganizationId == item.OrganizationId)
            .ToListAsync(cancellationToken);

        knowledgeUnits = knowledgeUnits.OrderBy(item => item.SourceUnit!.Ordinal).ThenBy(item => item.Id).ToList();
        var allEligibleKnowledgeUnits = knowledgeUnits.ToList();
        if (session.Mode == StudyMode.Review)
        {
            if (session.TrainingJson is not null && TrainingProgressService.Read<SessionTrainingSnapshot>(session.TrainingJson) is { MissionId: not null } training)
            {
                var mission = await db.DailyMissions.SingleAsync(x => x.Id == training.MissionId && x.OrganizationId == context.OrganizationId && x.StudentUserId == context.StudentId, cancellationToken);
                if (mission.Invalidated || mission.Revision != training.MissionRevision || mission.ScopeVersion != TrainingProgressService.Fingerprint(allEligibleKnowledgeUnits.Select(x => x.Id))) throw new TrainingConflictException("The assignment changed. Reload Training HQ.");
                var remaining = training.ReviewKnowledgeUnitIds.Except(TrainingProgressService.Ids(mission.AcceptedReviewIdsJson)).ToHashSet();
                knowledgeUnits = knowledgeUnits.Where(x => remaining.Contains(x.Id)).ToList();
            }
            else knowledgeUnits = knowledgeUnits.Where(item => due.Contains(item.Id)).ToList();
            if (knowledgeUnits.Count == 0)
            {
                throw new DomainException("There are no passages due for review.");
            }
        }

        // Exhaust each session cycle first, then balance persisted exposure across sessions.
        var selected = knowledgeUnits
            .OrderBy(item => session.Cards.Count(card => card.SourceUnitId == item.SourceUnitId))
            .ThenBy(item => exposure.Count(card => card.SourceUnitId == item.SourceUnitId))
            .ThenBy(item => due.Contains(item.Id) ? 0 : 1)
            .ThenBy(item => scope.PrimarySpecialistSourceUnitIds.Contains(item.SourceUnitId) ? 0 : 1)
            .ThenBy(item => exposure.Where(card => card.SourceUnitId == item.SourceUnitId)
                .Select(card => card.CreatedAtUtc).DefaultIfEmpty(DateTimeOffset.MinValue).Max())
            .ThenBy(item => item.SourceUnit!.Ordinal)
            .ThenBy(item => item.Id)
            .FirstOrDefault()
            ?? throw new DomainException("No eligible knowledge units remain.");

        if (selected.SourceUnit is null || !scope.EligibleSourceUnitIds.Contains(selected.SourceUnitId))
        {
            throw new DomainException("Cannot create a challenge from a source outside the student assignment.");
        }

        context = context with { Mode = session.Mode };
        var snapshot = RuleProfileReader.ReadSession(session, season.RuleProfile!);
        var nextUnit = allEligibleKnowledgeUnits
            .Select(item => item.SourceUnit)
            .Where(unit => unit is not null && unit.ContentPackId == selected.SourceUnit.ContentPackId && unit.Ordinal == selected.SourceUnit.Ordinal + 1)
            .Cast<SourceUnit>()
            .FirstOrDefault();
        var alternate = allEligibleKnowledgeUnits
            .Select(item => item.SourceUnit)
            .Where(unit => unit is not null && unit.Id != selected.SourceUnit.Id)
            .Cast<SourceUnit>()
            .FirstOrDefault();
        var distractors = allEligibleKnowledgeUnits
            .Select(item => item.SourceUnit!.CitationLabel)
            .Where(citation => citation != selected.SourceUnit.CitationLabel)
            .Distinct()
            .Take(6)
            .ToList();
        var usedTypes = session.Cards.OrderBy(card => card.Sequence).Select(card => card.ActivityType).ToList();
        var request = new ActivityRequest(
            context,
            selected,
            selected.SourceUnit,
            snapshot,
            Difficulty: (int)session.Difficulty,
            Sequence: session.Cards.Count + 1,
            nextUnit,
            alternate,
            distractors,
            usedTypes,
            session.TargetCardCount,
            NextKnowledgeUnitId: allEligibleKnowledgeUnits.FirstOrDefault(item => item.SourceUnitId == nextUnit?.Id)?.Id);

        var eligible = providers.Where(item => item.CanHandle(request)).ToList();
        var provider = ChooseProvider(eligible, usedTypes, request.Sequence)
            ?? throw new DomainException("No activity provider is available for the current rule profile and mode.");

        var card = await provider.CreateAsync(request, cancellationToken);
        db.ChallengeCards.Add(card);
        session.Status = StudySessionStatus.Active;
        await db.SaveChangesAsync(cancellationToken);
        return card;
    }

    private static IActivityProvider? ChooseProvider(
        IReadOnlyList<IActivityProvider> eligible,
        IReadOnlyCollection<string> usedTypes,
        int sequence)
    {
        if (eligible.Count == 0)
        {
            return null;
        }

        if (sequence == 1)
        {
            return eligible.FirstOrDefault(item => item.ActivityType == MissingWordsGenerator.ActivityType)
                ?? eligible[0];
        }

        return eligible
            .OrderBy(item => usedTypes.Count(type => type == item.ActivityType))
            .ThenBy(item => usedTypes.LastOrDefault() == item.ActivityType ? 1 : 0)
            .First();
    }
}
