using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Erudoza.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "AuditEvents",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    OrganizationId = table.Column<Guid>(type: "TEXT", nullable: false),
                    ActorUserId = table.Column<Guid>(type: "TEXT", nullable: true),
                    Action = table.Column<string>(type: "TEXT", nullable: false),
                    EntityType = table.Column<string>(type: "TEXT", nullable: false),
                    EntityId = table.Column<Guid>(type: "TEXT", nullable: true),
                    CorrelationId = table.Column<string>(type: "TEXT", nullable: true),
                    MetadataJson = table.Column<string>(type: "TEXT", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AuditEvents", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "GenerationJobs",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    OrganizationId = table.Column<Guid>(type: "TEXT", nullable: false),
                    SeasonId = table.Column<Guid>(type: "TEXT", nullable: true),
                    Status = table.Column<int>(type: "INTEGER", nullable: false),
                    PromptVersionKey = table.Column<string>(type: "TEXT", nullable: false),
                    Error = table.Column<string>(type: "TEXT", nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GenerationJobs", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "MasteryStates",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    OrganizationId = table.Column<Guid>(type: "TEXT", nullable: false),
                    StudentUserId = table.Column<Guid>(type: "TEXT", nullable: false),
                    SeasonId = table.Column<Guid>(type: "TEXT", nullable: false),
                    KnowledgeUnitId = table.Column<Guid>(type: "TEXT", nullable: false),
                    RecognitionScore = table.Column<int>(type: "INTEGER", nullable: false),
                    ExactWordingScore = table.Column<int>(type: "INTEGER", nullable: false),
                    ReferenceScore = table.Column<int>(type: "INTEGER", nullable: false),
                    SequenceScore = table.Column<int>(type: "INTEGER", nullable: false),
                    FactualRecallScore = table.Column<int>(type: "INTEGER", nullable: false),
                    Level = table.Column<int>(type: "INTEGER", nullable: false),
                    AlgorithmVersion = table.Column<string>(type: "TEXT", nullable: false),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MasteryStates", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Organizations",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    Name = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    Slug = table.Column<string>(type: "TEXT", maxLength: 120, nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Organizations", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "PromptVersions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    Key = table.Column<string>(type: "TEXT", nullable: false),
                    Version = table.Column<int>(type: "INTEGER", nullable: false),
                    Template = table.Column<string>(type: "TEXT", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PromptVersions", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "QuestionCandidates",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    OrganizationId = table.Column<Guid>(type: "TEXT", nullable: false),
                    SeasonId = table.Column<Guid>(type: "TEXT", nullable: true),
                    SchemaVersion = table.Column<string>(type: "TEXT", nullable: false),
                    QuestionType = table.Column<string>(type: "TEXT", nullable: false),
                    Prompt = table.Column<string>(type: "TEXT", nullable: false),
                    AnswerMode = table.Column<int>(type: "INTEGER", nullable: false),
                    CanonicalAnswer = table.Column<string>(type: "TEXT", nullable: false),
                    AcceptedAnswersJson = table.Column<string>(type: "TEXT", nullable: false),
                    Difficulty = table.Column<int>(type: "INTEGER", nullable: false),
                    Explanation = table.Column<string>(type: "TEXT", nullable: true),
                    GeneratorVersion = table.Column<string>(type: "TEXT", nullable: false),
                    Status = table.Column<int>(type: "INTEGER", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_QuestionCandidates", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ReviewSchedules",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    OrganizationId = table.Column<Guid>(type: "TEXT", nullable: false),
                    StudentUserId = table.Column<Guid>(type: "TEXT", nullable: false),
                    SeasonId = table.Column<Guid>(type: "TEXT", nullable: false),
                    KnowledgeUnitId = table.Column<Guid>(type: "TEXT", nullable: false),
                    DueAtUtc = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    AlgorithmVersion = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReviewSchedules", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "RuleProfiles",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    Key = table.Column<string>(type: "TEXT", maxLength: 80, nullable: false),
                    Version = table.Column<int>(type: "INTEGER", nullable: false),
                    ConfigurationJson = table.Column<string>(type: "TEXT", nullable: false),
                    IsBuiltIn = table.Column<bool>(type: "INTEGER", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RuleProfiles", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Users",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    UserName = table.Column<string>(type: "TEXT", maxLength: 120, nullable: false),
                    Email = table.Column<string>(type: "TEXT", maxLength: 256, nullable: true),
                    PasswordHash = table.Column<string>(type: "TEXT", nullable: false),
                    DisplayName = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    Kind = table.Column<int>(type: "INTEGER", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    IsActive = table.Column<bool>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Users", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ContentPacks",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    OrganizationId = table.Column<Guid>(type: "TEXT", nullable: false),
                    PackKey = table.Column<string>(type: "TEXT", nullable: false),
                    Version = table.Column<int>(type: "INTEGER", nullable: false),
                    Locale = table.Column<string>(type: "TEXT", nullable: false),
                    SourceType = table.Column<int>(type: "INTEGER", nullable: false),
                    LicensingStatus = table.Column<string>(type: "TEXT", nullable: false),
                    IsActive = table.Column<bool>(type: "INTEGER", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ContentPacks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ContentPacks_Organizations_OrganizationId",
                        column: x => x.OrganizationId,
                        principalTable: "Organizations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "PlayableQuestions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    OrganizationId = table.Column<Guid>(type: "TEXT", nullable: false),
                    QuestionCandidateId = table.Column<Guid>(type: "TEXT", nullable: false),
                    ContentPackId = table.Column<Guid>(type: "TEXT", nullable: false),
                    Status = table.Column<int>(type: "INTEGER", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PlayableQuestions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PlayableQuestions_QuestionCandidates_QuestionCandidateId",
                        column: x => x.QuestionCandidateId,
                        principalTable: "QuestionCandidates",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Seasons",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    OrganizationId = table.Column<Guid>(type: "TEXT", nullable: false),
                    Name = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    YearLabel = table.Column<string>(type: "TEXT", nullable: false),
                    Status = table.Column<int>(type: "INTEGER", nullable: false),
                    DefaultLocale = table.Column<string>(type: "TEXT", nullable: false),
                    RuleProfileId = table.Column<Guid>(type: "TEXT", nullable: false),
                    StartDate = table.Column<DateOnly>(type: "TEXT", nullable: true),
                    TargetCompetitionDate = table.Column<DateOnly>(type: "TEXT", nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    ActivatedAtUtc = table.Column<DateTimeOffset>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Seasons", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Seasons_Organizations_OrganizationId",
                        column: x => x.OrganizationId,
                        principalTable: "Organizations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_Seasons_RuleProfiles_RuleProfileId",
                        column: x => x.RuleProfileId,
                        principalTable: "RuleProfiles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "OrganizationMembers",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    OrganizationId = table.Column<Guid>(type: "TEXT", nullable: false),
                    UserId = table.Column<Guid>(type: "TEXT", nullable: false),
                    Role = table.Column<int>(type: "INTEGER", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OrganizationMembers", x => x.Id);
                    table.ForeignKey(
                        name: "FK_OrganizationMembers_Organizations_OrganizationId",
                        column: x => x.OrganizationId,
                        principalTable: "Organizations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_OrganizationMembers_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "StudentProfiles",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    UserId = table.Column<Guid>(type: "TEXT", nullable: false),
                    OrganizationId = table.Column<Guid>(type: "TEXT", nullable: false),
                    DisplayName = table.Column<string>(type: "TEXT", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StudentProfiles", x => x.Id);
                    table.ForeignKey(
                        name: "FK_StudentProfiles_Organizations_OrganizationId",
                        column: x => x.OrganizationId,
                        principalTable: "Organizations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_StudentProfiles_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "SourceDocuments",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    ContentPackId = table.Column<Guid>(type: "TEXT", nullable: false),
                    Name = table.Column<string>(type: "TEXT", nullable: false),
                    CanonicalBookKey = table.Column<string>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SourceDocuments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SourceDocuments_ContentPacks_ContentPackId",
                        column: x => x.ContentPackId,
                        principalTable: "ContentPacks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Assignments",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    OrganizationId = table.Column<Guid>(type: "TEXT", nullable: false),
                    SeasonId = table.Column<Guid>(type: "TEXT", nullable: false),
                    StudentUserId = table.Column<Guid>(type: "TEXT", nullable: false),
                    Type = table.Column<int>(type: "INTEGER", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Assignments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Assignments_Seasons_SeasonId",
                        column: x => x.SeasonId,
                        principalTable: "Seasons",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_Assignments_Users_StudentUserId",
                        column: x => x.StudentUserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ScopeEntries",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    OrganizationId = table.Column<Guid>(type: "TEXT", nullable: false),
                    SeasonId = table.Column<Guid>(type: "TEXT", nullable: false),
                    ContentPackId = table.Column<Guid>(type: "TEXT", nullable: false),
                    Kind = table.Column<int>(type: "INTEGER", nullable: false),
                    BookKey = table.Column<string>(type: "TEXT", nullable: false),
                    StartChapter = table.Column<int>(type: "INTEGER", nullable: false),
                    StartVerse = table.Column<int>(type: "INTEGER", nullable: false),
                    EndChapter = table.Column<int>(type: "INTEGER", nullable: false),
                    EndVerse = table.Column<int>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ScopeEntries", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ScopeEntries_ContentPacks_ContentPackId",
                        column: x => x.ContentPackId,
                        principalTable: "ContentPacks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ScopeEntries_Seasons_SeasonId",
                        column: x => x.SeasonId,
                        principalTable: "Seasons",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "StudySessions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    OrganizationId = table.Column<Guid>(type: "TEXT", nullable: false),
                    SeasonId = table.Column<Guid>(type: "TEXT", nullable: false),
                    StudentUserId = table.Column<Guid>(type: "TEXT", nullable: false),
                    Mode = table.Column<int>(type: "INTEGER", nullable: false),
                    Status = table.Column<int>(type: "INTEGER", nullable: false),
                    TargetCardCount = table.Column<int>(type: "INTEGER", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    CompletedAtUtc = table.Column<DateTimeOffset>(type: "TEXT", nullable: true),
                    StudentId = table.Column<Guid>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StudySessions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_StudySessions_Seasons_SeasonId",
                        column: x => x.SeasonId,
                        principalTable: "Seasons",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_StudySessions_Users_StudentId",
                        column: x => x.StudentId,
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "Teams",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    OrganizationId = table.Column<Guid>(type: "TEXT", nullable: false),
                    SeasonId = table.Column<Guid>(type: "TEXT", nullable: false),
                    Name = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Teams", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Teams_Seasons_SeasonId",
                        column: x => x.SeasonId,
                        principalTable: "Seasons",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "SourceUnits",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    ContentPackId = table.Column<Guid>(type: "TEXT", nullable: false),
                    SourceDocumentId = table.Column<Guid>(type: "TEXT", nullable: false),
                    OrganizationId = table.Column<Guid>(type: "TEXT", nullable: false),
                    SourceType = table.Column<int>(type: "INTEGER", nullable: false),
                    CanonicalText = table.Column<string>(type: "TEXT", maxLength: 4000, nullable: false),
                    NormalizedComparisonText = table.Column<string>(type: "TEXT", nullable: false),
                    ContentHash = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false),
                    CitationLabel = table.Column<string>(type: "TEXT", nullable: false),
                    Locale = table.Column<string>(type: "TEXT", nullable: false),
                    LicensingMetadata = table.Column<string>(type: "TEXT", nullable: false),
                    IsActive = table.Column<bool>(type: "INTEGER", nullable: false),
                    IsRetired = table.Column<bool>(type: "INTEGER", nullable: false),
                    BookKey = table.Column<string>(type: "TEXT", nullable: false),
                    Chapter = table.Column<int>(type: "INTEGER", nullable: false),
                    Verse = table.Column<int>(type: "INTEGER", nullable: false),
                    Ordinal = table.Column<int>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SourceUnits", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SourceUnits_ContentPacks_ContentPackId",
                        column: x => x.ContentPackId,
                        principalTable: "ContentPacks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_SourceUnits_SourceDocuments_SourceDocumentId",
                        column: x => x.SourceDocumentId,
                        principalTable: "SourceDocuments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "AssignmentScopes",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    AssignmentId = table.Column<Guid>(type: "TEXT", nullable: false),
                    ContentPackId = table.Column<Guid>(type: "TEXT", nullable: false),
                    BookKey = table.Column<string>(type: "TEXT", nullable: false),
                    StartChapter = table.Column<int>(type: "INTEGER", nullable: false),
                    StartVerse = table.Column<int>(type: "INTEGER", nullable: false),
                    EndChapter = table.Column<int>(type: "INTEGER", nullable: false),
                    EndVerse = table.Column<int>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AssignmentScopes", x => x.Id);
                    table.ForeignKey(
                        name: "FK_AssignmentScopes_Assignments_AssignmentId",
                        column: x => x.AssignmentId,
                        principalTable: "Assignments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_AssignmentScopes_ContentPacks_ContentPackId",
                        column: x => x.ContentPackId,
                        principalTable: "ContentPacks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "CompetitionMembers",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    OrganizationId = table.Column<Guid>(type: "TEXT", nullable: false),
                    SeasonId = table.Column<Guid>(type: "TEXT", nullable: false),
                    UserId = table.Column<Guid>(type: "TEXT", nullable: false),
                    TeamId = table.Column<Guid>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CompetitionMembers", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CompetitionMembers_Seasons_SeasonId",
                        column: x => x.SeasonId,
                        principalTable: "Seasons",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_CompetitionMembers_Teams_TeamId",
                        column: x => x.TeamId,
                        principalTable: "Teams",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_CompetitionMembers_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "KnowledgeUnits",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    OrganizationId = table.Column<Guid>(type: "TEXT", nullable: false),
                    SourceUnitId = table.Column<Guid>(type: "TEXT", nullable: false),
                    ContentPackId = table.Column<Guid>(type: "TEXT", nullable: false),
                    Kind = table.Column<int>(type: "INTEGER", nullable: false),
                    Title = table.Column<string>(type: "TEXT", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_KnowledgeUnits", x => x.Id);
                    table.ForeignKey(
                        name: "FK_KnowledgeUnits_ContentPacks_ContentPackId",
                        column: x => x.ContentPackId,
                        principalTable: "ContentPacks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_KnowledgeUnits_SourceUnits_SourceUnitId",
                        column: x => x.SourceUnitId,
                        principalTable: "SourceUnits",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "QuestionEvidence",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    QuestionCandidateId = table.Column<Guid>(type: "TEXT", nullable: false),
                    SourceUnitId = table.Column<Guid>(type: "TEXT", nullable: false),
                    EvidenceText = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_QuestionEvidence", x => x.Id);
                    table.ForeignKey(
                        name: "FK_QuestionEvidence_QuestionCandidates_QuestionCandidateId",
                        column: x => x.QuestionCandidateId,
                        principalTable: "QuestionCandidates",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_QuestionEvidence_SourceUnits_SourceUnitId",
                        column: x => x.SourceUnitId,
                        principalTable: "SourceUnits",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ChallengeCards",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    OrganizationId = table.Column<Guid>(type: "TEXT", nullable: false),
                    SessionId = table.Column<Guid>(type: "TEXT", nullable: false),
                    StudentUserId = table.Column<Guid>(type: "TEXT", nullable: false),
                    SeasonId = table.Column<Guid>(type: "TEXT", nullable: false),
                    KnowledgeUnitId = table.Column<Guid>(type: "TEXT", nullable: false),
                    SourceUnitId = table.Column<Guid>(type: "TEXT", nullable: false),
                    ActivityType = table.Column<string>(type: "TEXT", nullable: false),
                    ProviderType = table.Column<string>(type: "TEXT", nullable: false),
                    AnswerMode = table.Column<int>(type: "INTEGER", nullable: false),
                    EvaluatorVersion = table.Column<string>(type: "TEXT", nullable: false),
                    PayloadJson = table.Column<string>(type: "TEXT", nullable: false),
                    AnswerKeyJson = table.Column<string>(type: "TEXT", nullable: false),
                    Sequence = table.Column<int>(type: "INTEGER", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ChallengeCards", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ChallengeCards_KnowledgeUnits_KnowledgeUnitId",
                        column: x => x.KnowledgeUnitId,
                        principalTable: "KnowledgeUnits",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ChallengeCards_SourceUnits_SourceUnitId",
                        column: x => x.SourceUnitId,
                        principalTable: "SourceUnits",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ChallengeCards_StudySessions_SessionId",
                        column: x => x.SessionId,
                        principalTable: "StudySessions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Attempts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    OrganizationId = table.Column<Guid>(type: "TEXT", nullable: false),
                    SessionId = table.Column<Guid>(type: "TEXT", nullable: false),
                    ChallengeCardId = table.Column<Guid>(type: "TEXT", nullable: false),
                    StudentUserId = table.Column<Guid>(type: "TEXT", nullable: false),
                    SeasonId = table.Column<Guid>(type: "TEXT", nullable: false),
                    KnowledgeUnitId = table.Column<Guid>(type: "TEXT", nullable: false),
                    ClientSubmissionId = table.Column<string>(type: "TEXT", nullable: false),
                    SubmittedAnswer = table.Column<string>(type: "TEXT", nullable: false),
                    NormalizedAnswer = table.Column<string>(type: "TEXT", nullable: false),
                    IsCorrect = table.Column<bool>(type: "INTEGER", nullable: false),
                    EvaluationResult = table.Column<string>(type: "TEXT", nullable: false),
                    EvaluatorVersion = table.Column<string>(type: "TEXT", nullable: false),
                    ResponseTimeMs = table.Column<int>(type: "INTEGER", nullable: false),
                    HintsUsed = table.Column<bool>(type: "INTEGER", nullable: false),
                    ActivityType = table.Column<string>(type: "TEXT", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Attempts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Attempts_ChallengeCards_ChallengeCardId",
                        column: x => x.ChallengeCardId,
                        principalTable: "ChallengeCards",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_Attempts_StudySessions_SessionId",
                        column: x => x.SessionId,
                        principalTable: "StudySessions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Assignments_OrganizationId_SeasonId_StudentUserId_Type",
                table: "Assignments",
                columns: new[] { "OrganizationId", "SeasonId", "StudentUserId", "Type" });

            migrationBuilder.CreateIndex(
                name: "IX_Assignments_SeasonId",
                table: "Assignments",
                column: "SeasonId");

            migrationBuilder.CreateIndex(
                name: "IX_Assignments_StudentUserId",
                table: "Assignments",
                column: "StudentUserId");

            migrationBuilder.CreateIndex(
                name: "IX_AssignmentScopes_AssignmentId",
                table: "AssignmentScopes",
                column: "AssignmentId");

            migrationBuilder.CreateIndex(
                name: "IX_AssignmentScopes_ContentPackId",
                table: "AssignmentScopes",
                column: "ContentPackId");

            migrationBuilder.CreateIndex(
                name: "IX_Attempts_ChallengeCardId",
                table: "Attempts",
                column: "ChallengeCardId");

            migrationBuilder.CreateIndex(
                name: "IX_Attempts_OrganizationId_StudentUserId_SeasonId",
                table: "Attempts",
                columns: new[] { "OrganizationId", "StudentUserId", "SeasonId" });

            migrationBuilder.CreateIndex(
                name: "IX_Attempts_SessionId_ClientSubmissionId",
                table: "Attempts",
                columns: new[] { "SessionId", "ClientSubmissionId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_AuditEvents_OrganizationId_CreatedAtUtc",
                table: "AuditEvents",
                columns: new[] { "OrganizationId", "CreatedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_ChallengeCards_KnowledgeUnitId",
                table: "ChallengeCards",
                column: "KnowledgeUnitId");

            migrationBuilder.CreateIndex(
                name: "IX_ChallengeCards_SessionId_Sequence",
                table: "ChallengeCards",
                columns: new[] { "SessionId", "Sequence" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ChallengeCards_SourceUnitId",
                table: "ChallengeCards",
                column: "SourceUnitId");

            migrationBuilder.CreateIndex(
                name: "IX_CompetitionMembers_SeasonId",
                table: "CompetitionMembers",
                column: "SeasonId");

            migrationBuilder.CreateIndex(
                name: "IX_CompetitionMembers_TeamId",
                table: "CompetitionMembers",
                column: "TeamId");

            migrationBuilder.CreateIndex(
                name: "IX_CompetitionMembers_UserId",
                table: "CompetitionMembers",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_ContentPacks_OrganizationId_PackKey_Version",
                table: "ContentPacks",
                columns: new[] { "OrganizationId", "PackKey", "Version" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_KnowledgeUnits_ContentPackId",
                table: "KnowledgeUnits",
                column: "ContentPackId");

            migrationBuilder.CreateIndex(
                name: "IX_KnowledgeUnits_SourceUnitId_Kind",
                table: "KnowledgeUnits",
                columns: new[] { "SourceUnitId", "Kind" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_MasteryStates_OrganizationId_StudentUserId_SeasonId_KnowledgeUnitId",
                table: "MasteryStates",
                columns: new[] { "OrganizationId", "StudentUserId", "SeasonId", "KnowledgeUnitId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_OrganizationMembers_OrganizationId_UserId",
                table: "OrganizationMembers",
                columns: new[] { "OrganizationId", "UserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_OrganizationMembers_UserId",
                table: "OrganizationMembers",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_Organizations_Slug",
                table: "Organizations",
                column: "Slug",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PlayableQuestions_OrganizationId_Status",
                table: "PlayableQuestions",
                columns: new[] { "OrganizationId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_PlayableQuestions_QuestionCandidateId",
                table: "PlayableQuestions",
                column: "QuestionCandidateId");

            migrationBuilder.CreateIndex(
                name: "IX_QuestionCandidates_OrganizationId_Status",
                table: "QuestionCandidates",
                columns: new[] { "OrganizationId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_QuestionEvidence_QuestionCandidateId",
                table: "QuestionEvidence",
                column: "QuestionCandidateId");

            migrationBuilder.CreateIndex(
                name: "IX_QuestionEvidence_SourceUnitId",
                table: "QuestionEvidence",
                column: "SourceUnitId");

            migrationBuilder.CreateIndex(
                name: "IX_ReviewSchedules_OrganizationId_StudentUserId_SeasonId_KnowledgeUnitId",
                table: "ReviewSchedules",
                columns: new[] { "OrganizationId", "StudentUserId", "SeasonId", "KnowledgeUnitId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ReviewSchedules_StudentUserId_DueAtUtc",
                table: "ReviewSchedules",
                columns: new[] { "StudentUserId", "DueAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_RuleProfiles_Key_Version",
                table: "RuleProfiles",
                columns: new[] { "Key", "Version" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ScopeEntries_ContentPackId",
                table: "ScopeEntries",
                column: "ContentPackId");

            migrationBuilder.CreateIndex(
                name: "IX_ScopeEntries_OrganizationId_SeasonId",
                table: "ScopeEntries",
                columns: new[] { "OrganizationId", "SeasonId" });

            migrationBuilder.CreateIndex(
                name: "IX_ScopeEntries_SeasonId",
                table: "ScopeEntries",
                column: "SeasonId");

            migrationBuilder.CreateIndex(
                name: "IX_Seasons_OrganizationId_Name",
                table: "Seasons",
                columns: new[] { "OrganizationId", "Name" });

            migrationBuilder.CreateIndex(
                name: "IX_Seasons_RuleProfileId",
                table: "Seasons",
                column: "RuleProfileId");

            migrationBuilder.CreateIndex(
                name: "IX_SourceDocuments_ContentPackId",
                table: "SourceDocuments",
                column: "ContentPackId");

            migrationBuilder.CreateIndex(
                name: "IX_SourceUnits_ContentHash",
                table: "SourceUnits",
                column: "ContentHash");

            migrationBuilder.CreateIndex(
                name: "IX_SourceUnits_ContentPackId_BookKey_Chapter_Verse",
                table: "SourceUnits",
                columns: new[] { "ContentPackId", "BookKey", "Chapter", "Verse" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SourceUnits_OrganizationId_BookKey_Chapter_Verse",
                table: "SourceUnits",
                columns: new[] { "OrganizationId", "BookKey", "Chapter", "Verse" });

            migrationBuilder.CreateIndex(
                name: "IX_SourceUnits_SourceDocumentId",
                table: "SourceUnits",
                column: "SourceDocumentId");

            migrationBuilder.CreateIndex(
                name: "IX_StudentProfiles_OrganizationId_UserId",
                table: "StudentProfiles",
                columns: new[] { "OrganizationId", "UserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_StudentProfiles_UserId",
                table: "StudentProfiles",
                column: "UserId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_StudySessions_OrganizationId_StudentUserId_SeasonId_Status",
                table: "StudySessions",
                columns: new[] { "OrganizationId", "StudentUserId", "SeasonId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_StudySessions_SeasonId",
                table: "StudySessions",
                column: "SeasonId");

            migrationBuilder.CreateIndex(
                name: "IX_StudySessions_StudentId",
                table: "StudySessions",
                column: "StudentId");

            migrationBuilder.CreateIndex(
                name: "IX_Teams_SeasonId",
                table: "Teams",
                column: "SeasonId");

            migrationBuilder.CreateIndex(
                name: "IX_Users_Email",
                table: "Users",
                column: "Email");

            migrationBuilder.CreateIndex(
                name: "IX_Users_UserName",
                table: "Users",
                column: "UserName",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AssignmentScopes");

            migrationBuilder.DropTable(
                name: "Attempts");

            migrationBuilder.DropTable(
                name: "AuditEvents");

            migrationBuilder.DropTable(
                name: "CompetitionMembers");

            migrationBuilder.DropTable(
                name: "GenerationJobs");

            migrationBuilder.DropTable(
                name: "MasteryStates");

            migrationBuilder.DropTable(
                name: "OrganizationMembers");

            migrationBuilder.DropTable(
                name: "PlayableQuestions");

            migrationBuilder.DropTable(
                name: "PromptVersions");

            migrationBuilder.DropTable(
                name: "QuestionEvidence");

            migrationBuilder.DropTable(
                name: "ReviewSchedules");

            migrationBuilder.DropTable(
                name: "ScopeEntries");

            migrationBuilder.DropTable(
                name: "StudentProfiles");

            migrationBuilder.DropTable(
                name: "Assignments");

            migrationBuilder.DropTable(
                name: "ChallengeCards");

            migrationBuilder.DropTable(
                name: "Teams");

            migrationBuilder.DropTable(
                name: "QuestionCandidates");

            migrationBuilder.DropTable(
                name: "KnowledgeUnits");

            migrationBuilder.DropTable(
                name: "StudySessions");

            migrationBuilder.DropTable(
                name: "SourceUnits");

            migrationBuilder.DropTable(
                name: "Seasons");

            migrationBuilder.DropTable(
                name: "Users");

            migrationBuilder.DropTable(
                name: "SourceDocuments");

            migrationBuilder.DropTable(
                name: "RuleProfiles");

            migrationBuilder.DropTable(
                name: "ContentPacks");

            migrationBuilder.DropTable(
                name: "Organizations");
        }
    }
}
