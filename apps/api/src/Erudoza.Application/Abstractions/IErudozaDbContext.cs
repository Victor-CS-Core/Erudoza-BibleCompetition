using Erudoza.Domain;
using Microsoft.EntityFrameworkCore;

namespace Erudoza.Application.Abstractions;

public interface IErudozaDbContext
{
    DbSet<Organization> Organizations { get; }
    DbSet<ApplicationUser> Users { get; }
    DbSet<StudentProfile> StudentProfiles { get; }
    DbSet<OrganizationMember> OrganizationMembers { get; }
    DbSet<CompetitionSeason> Seasons { get; }
    DbSet<RuleProfile> RuleProfiles { get; }
    DbSet<CompetitionScopeEntry> ScopeEntries { get; }
    DbSet<Assignment> Assignments { get; }
    DbSet<AssignmentScope> AssignmentScopes { get; }
    DbSet<Team> Teams { get; }
    DbSet<CompetitionMember> CompetitionMembers { get; }
    DbSet<ContentPack> ContentPacks { get; }
    DbSet<SourceDocument> SourceDocuments { get; }
    DbSet<SourceUnit> SourceUnits { get; }
    DbSet<KnowledgeUnit> KnowledgeUnits { get; }
    DbSet<StudySession> StudySessions { get; }
    DbSet<ChallengeCard> ChallengeCards { get; }
    DbSet<Attempt> Attempts { get; }
    DbSet<MasteryState> MasteryStates { get; }
    DbSet<ReviewSchedule> ReviewSchedules { get; }
    DbSet<AuditEvent> AuditEvents { get; }

    Task<int> SaveChangesAsync(CancellationToken cancellationToken = default);
}
