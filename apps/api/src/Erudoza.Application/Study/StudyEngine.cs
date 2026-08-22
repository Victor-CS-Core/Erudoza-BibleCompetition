using Erudoza.Application.Abstractions;
using Erudoza.Application.Competitions;
using Erudoza.Domain;
using Erudoza.Domain.Study;
using Microsoft.EntityFrameworkCore;

namespace Erudoza.Application.Study;

public sealed class StudyEngine(
    IErudozaDbContext db,
    IStudentStudyScopeService studyScope,
    IReadOnlyList<IActivityProvider> providers) : IStudyEngine
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
            return unanswered;
        }

        if (session.Cards.Count >= session.TargetCardCount)
        {
            throw new DomainException("The session target has been reached.");
        }

        var scope = await studyScope.GetAsync(context.StudentId, context.SeasonId, cancellationToken);
        if (scope.EligibleSourceUnitIds.Count == 0)
        {
            throw new DomainException("The student has no assigned study scope.");
        }

        var usedKnowledge = session.Cards.Select(card => card.KnowledgeUnitId).ToHashSet();
        var now = DateTimeOffset.UtcNow;
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
            .Where(item => item.OrganizationId == context.OrganizationId
                && scope.EligibleSourceUnitIds.Contains(item.SourceUnitId)
                && item.Kind == KnowledgeUnitKind.ExactVerseText)
            .ToListAsync(cancellationToken);

        if (session.Mode == StudyMode.Review)
        {
            knowledgeUnits = knowledgeUnits.Where(item => due.Contains(item.Id)).ToList();
            if (knowledgeUnits.Count == 0)
            {
                throw new DomainException("There are no passages due for review.");
            }
        }

        var selected = knowledgeUnits
            .OrderBy(item => usedKnowledge.Contains(item.Id))
            .ThenBy(item => due.Contains(item.Id) ? 0 : 1)
            .ThenBy(item => scope.PrimarySpecialistSourceUnitIds.Contains(item.SourceUnitId) ? 0 : 1)
            .ThenBy(item => item.SourceUnit!.Ordinal)
            .FirstOrDefault(item => !usedKnowledge.Contains(item.Id))
            ?? knowledgeUnits.FirstOrDefault()
            ?? throw new DomainException("No eligible knowledge units remain.");

        if (selected.SourceUnit is null || !scope.EligibleSourceUnitIds.Contains(selected.SourceUnitId))
        {
            throw new DomainException("Cannot create a challenge from a source outside the student assignment.");
        }

        context = context with { Mode = session.Mode };
        var snapshot = RuleProfileReader.Read(season.RuleProfile!);
        var nextUnit = knowledgeUnits
            .Select(item => item.SourceUnit)
            .Where(unit => unit is not null && unit.ContentPackId == selected.SourceUnit.ContentPackId && unit.Ordinal == selected.SourceUnit.Ordinal + 1)
            .Cast<SourceUnit>()
            .FirstOrDefault();
        var alternate = knowledgeUnits
            .Select(item => item.SourceUnit)
            .Where(unit => unit is not null && unit.Id != selected.SourceUnit.Id)
            .Cast<SourceUnit>()
            .FirstOrDefault();
        var distractors = knowledgeUnits
            .Select(item => item.SourceUnit!.CitationLabel)
            .Where(citation => citation != selected.SourceUnit.CitationLabel)
            .Distinct()
            .Take(6)
            .ToList();
        var usedTypes = session.Cards.Select(card => card.ActivityType).ToList();
        var playable = (await db.PlayableQuestions
            .Include(item => item.QuestionCandidate)
            .ThenInclude(item => item!.Evidence)
            .Where(item => item.OrganizationId == context.OrganizationId && item.Status == QuestionLifecycleStatus.Playable)
            .ToListAsync(cancellationToken))
            .Where(item => item.QuestionCandidate?.Evidence.Any(evidence => evidence.SourceUnitId == selected.SourceUnitId) == true)
            .OrderBy(item => item.CreatedAtUtc)
            .FirstOrDefault();
        var request = new ActivityRequest(
            context,
            selected,
            selected.SourceUnit,
            snapshot,
            Difficulty: session.Cards.Count >= session.TargetCardCount - 1 ? 3 : 1,
            Sequence: session.Cards.Count + 1,
            nextUnit,
            alternate,
            distractors,
            usedTypes,
            session.TargetCardCount,
            playable);

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
