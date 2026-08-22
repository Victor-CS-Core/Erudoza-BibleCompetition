using Erudoza.Domain;
using FluentAssertions;

namespace Erudoza.UnitTests;

public sealed class DomainInvariantTests
{
    [Fact]
    public void Season_must_belong_to_the_requested_organization()
    {
        var season = new CompetitionSeason { OrganizationId = Guid.NewGuid() };
        var act = () => DomainInvariants.EnsureSeasonBelongsToOrganization(season, Guid.NewGuid());
        act.Should().Throw<DomainException>();
    }

    [Fact]
    public void Assignment_must_share_the_season_organization()
    {
        var season = new CompetitionSeason { Id = Guid.NewGuid(), OrganizationId = Guid.NewGuid() };
        var assignment = new Assignment { SeasonId = season.Id, OrganizationId = Guid.NewGuid() };
        var act = () => DomainInvariants.EnsureAssignmentMatchesSeason(assignment, season);
        act.Should().Throw<DomainException>();
    }

    [Fact]
    public void Question_evidence_must_stay_inside_scope()
    {
        var allowed = new HashSet<Guid> { Guid.NewGuid() };
        var act = () => DomainInvariants.EnsureQuestionEvidenceInScope(Guid.NewGuid(), allowed);
        act.Should().Throw<DomainException>();
    }

    [Fact]
    public void Attempts_cannot_cross_session_boundaries()
    {
        var session = new StudySession
        {
            Id = Guid.NewGuid(),
            OrganizationId = Guid.NewGuid(),
            SeasonId = Guid.NewGuid(),
            StudentUserId = Guid.NewGuid()
        };
        var card = new ChallengeCard
        {
            Id = Guid.NewGuid(),
            SessionId = Guid.NewGuid(),
            OrganizationId = session.OrganizationId,
            StudentUserId = session.StudentUserId
        };
        var attempt = new Attempt
        {
            OrganizationId = session.OrganizationId,
            SeasonId = session.SeasonId,
            StudentUserId = session.StudentUserId,
            SessionId = session.Id,
            ChallengeCardId = card.Id
        };

        var act = () => DomainInvariants.EnsureAttemptBoundaries(attempt, session, card);
        act.Should().Throw<DomainException>();
    }

    [Fact]
    public void Activation_requires_scope_and_rule_profile()
    {
        var act = () => DomainInvariants.EnsureSeasonCanActivate(false, 0, false);
        act.Should().Throw<DomainException>();
    }

    [Fact]
    public void Draft_seasons_cannot_start_study()
    {
        var season = new CompetitionSeason { Status = SeasonStatus.Draft };
        var act = () => DomainInvariants.EnsureSeasonIsActiveForStudy(season);
        act.Should().Throw<DomainException>();
    }
}
