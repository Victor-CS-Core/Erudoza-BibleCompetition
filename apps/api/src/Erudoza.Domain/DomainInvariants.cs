namespace Erudoza.Domain;

public sealed class DomainException : Exception
{
    public DomainException(string message) : base(message)
    {
    }
}

public static class DomainInvariants
{
    public static void EnsureSeasonBelongsToOrganization(CompetitionSeason season, Guid organizationId)
    {
        if (season.OrganizationId != organizationId)
        {
            throw new DomainException("Season does not belong to the requested organization.");
        }
    }

    public static void EnsureAssignmentMatchesSeason(Assignment assignment, CompetitionSeason season)
    {
        if (assignment.SeasonId != season.Id || assignment.OrganizationId != season.OrganizationId)
        {
            throw new DomainException("Assignment is not bound to the season organization boundary.");
        }
    }

    public static void EnsureSourceUnitInPack(SourceUnit unit, ContentPack pack)
    {
        if (unit.ContentPackId != pack.Id || unit.OrganizationId != pack.OrganizationId)
        {
            throw new DomainException("Source unit is not owned by the content pack organization.");
        }
    }

    public static void EnsureQuestionEvidenceInScope(Guid sourceUnitId, IReadOnlySet<Guid> allowedSourceUnitIds)
    {
        if (!allowedSourceUnitIds.Contains(sourceUnitId))
        {
            throw new DomainException("Question evidence cites a source unit outside the allowed scope.");
        }
    }

    public static void EnsureAttemptBoundaries(Attempt attempt, StudySession session, ChallengeCard card)
    {
        if (attempt.OrganizationId != session.OrganizationId
            || attempt.SeasonId != session.SeasonId
            || attempt.StudentUserId != session.StudentUserId
            || attempt.SessionId != session.Id)
        {
            throw new DomainException("Attempt crosses session, student, season, or organization boundaries.");
        }

        if (card.Id != attempt.ChallengeCardId
            || card.SessionId != session.Id
            || card.OrganizationId != session.OrganizationId
            || card.StudentUserId != session.StudentUserId)
        {
            throw new DomainException("Challenge card is not part of the student session.");
        }
    }

    public static void EnsureSeasonCanActivate(bool hasRuleProfile, int resolvedSourceUnitCount, bool contentIntegrityPassed)
    {
        if (!hasRuleProfile)
        {
            throw new DomainException("A rule profile version is required before activation.");
        }

        if (resolvedSourceUnitCount <= 0)
        {
            throw new DomainException("Competition scope must resolve to at least one source unit.");
        }

        if (!contentIntegrityPassed)
        {
            throw new DomainException("Selected content packs failed integrity checks.");
        }
    }

    public static void EnsureSeasonIsActiveForStudy(CompetitionSeason season)
    {
        if (season.Status != SeasonStatus.Active)
        {
            throw new DomainException("Study sessions can only start for an Active season.");
        }
    }
}
