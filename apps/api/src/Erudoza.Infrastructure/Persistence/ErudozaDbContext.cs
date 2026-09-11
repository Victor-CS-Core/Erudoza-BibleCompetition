using Erudoza.Application.Abstractions;
using Erudoza.Domain;
using Microsoft.EntityFrameworkCore;

namespace Erudoza.Infrastructure.Persistence;

public sealed class ErudozaDbContext(DbContextOptions<ErudozaDbContext> options)
    : DbContext(options), IErudozaDbContext
{
    public DbSet<TrainingPreference> TrainingPreferences => Set<TrainingPreference>();
    public DbSet<TrainingDay> TrainingDays => Set<TrainingDay>();
    public DbSet<TrainingWeek> TrainingWeeks => Set<TrainingWeek>();
    public DbSet<DailyMission> DailyMissions => Set<DailyMission>();
    public DbSet<TrainingSeasonProgress> TrainingSeasonProgress => Set<TrainingSeasonProgress>();
    public DbSet<SoloBadgeAward> SoloBadgeAwards => Set<SoloBadgeAward>();
    public DbSet<Organization> Organizations => Set<Organization>();
    public DbSet<ApplicationUser> Users => Set<ApplicationUser>();
    public DbSet<StudentProfile> StudentProfiles => Set<StudentProfile>();
    public DbSet<OrganizationMember> OrganizationMembers => Set<OrganizationMember>();
    public DbSet<CompetitionSeason> Seasons => Set<CompetitionSeason>();
    public DbSet<RuleProfile> RuleProfiles => Set<RuleProfile>();
    public DbSet<CompetitionScopeEntry> ScopeEntries => Set<CompetitionScopeEntry>();
    public DbSet<Assignment> Assignments => Set<Assignment>();
    public DbSet<AssignmentScope> AssignmentScopes => Set<AssignmentScope>();
    public DbSet<Team> Teams => Set<Team>();
    public DbSet<CompetitionMember> CompetitionMembers => Set<CompetitionMember>();
    public DbSet<ContentPack> ContentPacks => Set<ContentPack>();
    public DbSet<SourceDocument> SourceDocuments => Set<SourceDocument>();
    public DbSet<SourceUnit> SourceUnits => Set<SourceUnit>();
    public DbSet<KnowledgeUnit> KnowledgeUnits => Set<KnowledgeUnit>();
    public DbSet<QuestionCandidate> QuestionCandidates => Set<QuestionCandidate>();
    public DbSet<PlayableQuestion> PlayableQuestions => Set<PlayableQuestion>();
    public DbSet<QuestionEvidence> QuestionEvidence => Set<QuestionEvidence>();
    public DbSet<StudySession> StudySessions => Set<StudySession>();
    public DbSet<ChallengeCard> ChallengeCards => Set<ChallengeCard>();
    public DbSet<Attempt> Attempts => Set<Attempt>();
    public DbSet<MasteryState> MasteryStates => Set<MasteryState>();
    public DbSet<ReviewSchedule> ReviewSchedules => Set<ReviewSchedule>();
    public DbSet<GenerationJob> GenerationJobs => Set<GenerationJob>();
    public DbSet<PromptVersion> PromptVersions => Set<PromptVersion>();
    public DbSet<AuditEvent> AuditEvents => Set<AuditEvent>();

    public override int SaveChanges(bool acceptAllChangesOnSuccess)
    {
        ProtectInstalledLibrary();
        return base.SaveChanges(acceptAllChangesOnSuccess);
    }

    public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    {
        ProtectInstalledLibrary();
        return base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
    }

    private void ProtectInstalledLibrary()
    {
        ChangeTracker.DetectChanges();
        var changed = ChangeTracker.Entries().Where(e => e.State is EntityState.Modified or EntityState.Deleted or EntityState.Added).ToList();
        if (changed.Any(e => e.Entity is ContentPack && e.State != EntityState.Added
            && ((bool)e.OriginalValues[nameof(ContentPack.IsBuiltIn)]! || ((ContentPack)e.Entity).IsBuiltIn
                || (Guid)e.OriginalValues[nameof(ContentPack.OrganizationId)]! == BuiltInLibrary.OrganizationId
                || ((ContentPack)e.Entity).OrganizationId == BuiltInLibrary.OrganizationId)))
            throw new DomainException("The built-in NKJV library is immutable.");
        var packIds = changed.SelectMany(e => e.Entity switch
        {
            SourceUnit u => new[] { u.ContentPackId, e.State == EntityState.Added ? u.ContentPackId : (Guid)e.OriginalValues[nameof(SourceUnit.ContentPackId)]! },
            SourceDocument d => new[] { d.ContentPackId, e.State == EntityState.Added ? d.ContentPackId : (Guid)e.OriginalValues[nameof(SourceDocument.ContentPackId)]! },
            KnowledgeUnit k => new[] { k.ContentPackId, e.State == EntityState.Added ? k.ContentPackId : (Guid)e.OriginalValues[nameof(KnowledgeUnit.ContentPackId)]! },
            _ => Array.Empty<Guid>()
        }).Distinct().ToArray();
        if (packIds.Length > 0 && ContentPacks.AsNoTracking().Any(p => packIds.Contains(p.Id)
                && (p.IsBuiltIn || p.OrganizationId == BuiltInLibrary.OrganizationId)))
            throw new DomainException("The built-in NKJV library is immutable.");
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<TrainingPreference>().HasKey(x => new { x.OrganizationId, x.StudentUserId });
        modelBuilder.Entity<TrainingPreference>().Property(x => x.Revision).IsConcurrencyToken();
        modelBuilder.Entity<TrainingDay>().HasKey(x => new { x.OrganizationId, x.StudentUserId, x.LocalDate });
        modelBuilder.Entity<TrainingWeek>().HasKey(x => new { x.OrganizationId, x.StudentUserId, x.WeekStartLocalDate });
        modelBuilder.Entity<DailyMission>().HasIndex(x => new { x.OrganizationId, x.StudentUserId, x.SeasonId, x.LocalDate, x.Revision }).IsUnique();
        modelBuilder.Entity<TrainingSeasonProgress>().HasKey(x => new { x.OrganizationId, x.StudentUserId, x.SeasonId, x.ScopeVersion });
        modelBuilder.Entity<SoloBadgeAward>().HasKey(x => new { x.OrganizationId, x.StudentUserId, x.Key, x.RuleVersion, x.AwardScope });
        modelBuilder.Entity<StudySession>().HasIndex(x => new { x.OrganizationId, x.StudentUserId, x.ClientStartId }).IsUnique().HasFilter("\"ClientStartId\" IS NOT NULL");
        modelBuilder.Entity<PracticeRoomRecord>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.HasIndex(x => new { x.OrganizationId, x.Status });
            entity.Property(x => x.Revision).IsConcurrencyToken();
            entity.Property(x => x.Status).HasMaxLength(24);
        });
        modelBuilder.Entity<PracticeQuestionRecord>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.HasIndex(x => new { x.OrganizationId, x.QuestionKey, x.Version }).IsUnique();
        });
        modelBuilder.Entity<PracticeSetting>().HasKey(x => x.OrganizationId);
        modelBuilder.Entity<PracticeAwardRecord>(entity =>
        {
            entity.HasKey(x => new { x.OrganizationId, x.SeasonId, x.UserId, x.Key });
            entity.Property(x => x.Key).HasMaxLength(64);
            entity.Property(x => x.Title).HasMaxLength(100);
        });
        modelBuilder.Entity<Organization>(entity =>
        {
            entity.HasIndex(item => item.Slug).IsUnique();
            entity.Property(item => item.Name).HasMaxLength(200);
            entity.Property(item => item.Slug).HasMaxLength(120);
        });

        modelBuilder.Entity<ApplicationUser>(entity =>
        {
            entity.HasIndex(item => item.UserName).IsUnique();
            entity.HasIndex(item => item.Email);
            entity.Property(item => item.UserName).HasMaxLength(120);
            entity.Property(item => item.Email).HasMaxLength(256);
            entity.Property(item => item.DisplayName).HasMaxLength(200);
            entity.HasOne(item => item.StudentProfile)
                .WithOne(item => item.User)
                .HasForeignKey<StudentProfile>(item => item.UserId);
        });

        modelBuilder.Entity<OrganizationMember>(entity =>
        {
            entity.HasIndex(item => new { item.OrganizationId, item.UserId }).IsUnique();
            entity.HasOne(item => item.Organization).WithMany(item => item.Members).HasForeignKey(item => item.OrganizationId);
            entity.HasOne(item => item.User).WithMany(item => item.Memberships).HasForeignKey(item => item.UserId);
        });

        modelBuilder.Entity<StudentProfile>(entity =>
        {
            entity.HasIndex(item => new { item.OrganizationId, item.UserId }).IsUnique();
        });

        modelBuilder.Entity<CompetitionSeason>(entity =>
        {
            entity.HasIndex(item => new { item.OrganizationId, item.Name });
            entity.HasOne(item => item.Organization).WithMany(item => item.Seasons).HasForeignKey(item => item.OrganizationId);
            entity.HasOne(item => item.RuleProfile).WithMany().HasForeignKey(item => item.RuleProfileId);
            entity.Property(item => item.Name).HasMaxLength(200);
        });

        modelBuilder.Entity<CompetitionMember>(entity =>
        {
            entity.HasIndex(item => new { item.OrganizationId, item.SeasonId, item.UserId }).IsUnique();
        });

        modelBuilder.Entity<RuleProfile>(entity =>
        {
            entity.HasIndex(item => new { item.Key, item.Version }).IsUnique();
            entity.Property(item => item.Key).HasMaxLength(80);
        });

        modelBuilder.Entity<CompetitionScopeEntry>(entity =>
        {
            entity.HasIndex(item => new { item.OrganizationId, item.SeasonId });
            entity.HasOne(item => item.Season).WithMany(item => item.ScopeEntries).HasForeignKey(item => item.SeasonId);
        });

        modelBuilder.Entity<Assignment>(entity =>
        {
            entity.HasIndex(item => new { item.OrganizationId, item.SeasonId, item.StudentUserId, item.Type });
            entity.HasOne(item => item.Season).WithMany(item => item.Assignments).HasForeignKey(item => item.SeasonId);
            entity.HasOne(item => item.Student).WithMany().HasForeignKey(item => item.StudentUserId);
        });

        modelBuilder.Entity<AssignmentScope>(entity =>
        {
            entity.HasOne(item => item.Assignment).WithMany(item => item.Scopes).HasForeignKey(item => item.AssignmentId);
        });

        modelBuilder.Entity<ContentPack>(entity =>
        {
            entity.HasIndex(item => new { item.OrganizationId, item.PackKey, item.Version }).IsUnique();
            entity.HasOne(item => item.Organization).WithMany(item => item.ContentPacks).HasForeignKey(item => item.OrganizationId);
        });

        modelBuilder.Entity<SourceUnit>(entity =>
        {
            entity.HasIndex(item => new { item.ContentPackId, item.BookKey, item.Chapter, item.Verse }).IsUnique();
            entity.HasIndex(item => item.ContentHash);
            entity.HasIndex(item => new { item.OrganizationId, item.BookKey, item.Chapter, item.Verse });
            entity.HasOne(item => item.ContentPack).WithMany(item => item.SourceUnits).HasForeignKey(item => item.ContentPackId);
            entity.HasOne(item => item.SourceDocument).WithMany(item => item.Units).HasForeignKey(item => item.SourceDocumentId);
            entity.Property(item => item.CanonicalText).HasMaxLength(4000);
            entity.Property(item => item.ContentHash).HasMaxLength(64);
        });

        modelBuilder.Entity<KnowledgeUnit>(entity =>
        {
            entity.HasIndex(item => new { item.SourceUnitId, item.Kind }).IsUnique();
            entity.HasOne(item => item.SourceUnit).WithMany(item => item.KnowledgeUnits).HasForeignKey(item => item.SourceUnitId);
        });

        modelBuilder.Entity<QuestionCandidate>(entity =>
        {
            entity.HasIndex(item => new { item.OrganizationId, item.Status });
            entity.HasMany(item => item.Evidence)
                .WithOne(item => item.QuestionCandidate)
                .HasForeignKey(item => item.QuestionCandidateId);
        });

        modelBuilder.Entity<PlayableQuestion>(entity =>
        {
            entity.HasIndex(item => new { item.OrganizationId, item.Status });
            entity.HasOne(item => item.QuestionCandidate)
                .WithMany()
                .HasForeignKey(item => item.QuestionCandidateId);
        });

        modelBuilder.Entity<StudySession>(entity =>
        {
            entity.HasIndex(item => new { item.OrganizationId, item.StudentUserId, item.SeasonId, item.Status });
        });

        modelBuilder.Entity<ChallengeCard>(entity =>
        {
            entity.HasIndex(item => new { item.SessionId, item.Sequence }).IsUnique();
        });

        modelBuilder.Entity<Attempt>(entity =>
        {
            entity.HasIndex(item => item.ChallengeCardId).IsUnique().HasFilter("[IsLegacyDuplicate] = 0");
            entity.HasIndex(item => new { item.SessionId, item.ClientSubmissionId }).IsUnique();
            entity.HasIndex(item => new { item.OrganizationId, item.StudentUserId, item.SeasonId });
        });

        modelBuilder.Entity<MasteryState>(entity =>
        {
            entity.HasIndex(item => new { item.OrganizationId, item.StudentUserId, item.SeasonId, item.KnowledgeUnitId }).IsUnique();
        });

        modelBuilder.Entity<ReviewSchedule>(entity =>
        {
            entity.HasIndex(item => new { item.StudentUserId, item.DueAtUtc });
            entity.HasIndex(item => new { item.OrganizationId, item.StudentUserId, item.SeasonId, item.KnowledgeUnitId }).IsUnique();
        });

        modelBuilder.Entity<AuditEvent>(entity =>
        {
            entity.HasIndex(item => new { item.OrganizationId, item.CreatedAtUtc });
        });
    }
}
