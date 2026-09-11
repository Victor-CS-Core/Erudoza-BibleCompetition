using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Erudoza.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class TrainingProgression : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ClientStartId",
                table: "StudySessions",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "RecapJson",
                table: "StudySessions",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "StartPayloadJson",
                table: "StudySessions",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TrainingJson",
                table: "StudySessions",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "LastAttemptId",
                table: "MasteryStates",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AfterSkillsJson",
                table: "Attempts",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BeforeSkillsJson",
                table: "Attempts",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "PreviousAttemptId",
                table: "Attempts",
                type: "TEXT",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "DailyMissions",
                columns: table => new
                {
                    Id = table.Column<string>(type: "TEXT", nullable: false),
                    OrganizationId = table.Column<Guid>(type: "TEXT", nullable: false),
                    StudentUserId = table.Column<Guid>(type: "TEXT", nullable: false),
                    SeasonId = table.Column<Guid>(type: "TEXT", nullable: false),
                    LocalDate = table.Column<string>(type: "TEXT", nullable: false),
                    TimeZone = table.Column<string>(type: "TEXT", nullable: false),
                    Revision = table.Column<int>(type: "INTEGER", nullable: false),
                    ScopeVersion = table.Column<string>(type: "TEXT", nullable: false),
                    EligibleIdsJson = table.Column<string>(type: "TEXT", nullable: false),
                    ReviewIdsJson = table.Column<string>(type: "TEXT", nullable: false),
                    AcceptedReviewIdsJson = table.Column<string>(type: "TEXT", nullable: false),
                    Invalidated = table.Column<bool>(type: "INTEGER", nullable: false),
                    ReviewSessionId = table.Column<Guid>(type: "TEXT", nullable: true),
                    PracticeSessionId = table.Column<Guid>(type: "TEXT", nullable: true),
                    PracticeCompleted = table.Column<int>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DailyMissions", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "SoloBadgeAwards",
                columns: table => new
                {
                    OrganizationId = table.Column<Guid>(type: "TEXT", nullable: false),
                    StudentUserId = table.Column<Guid>(type: "TEXT", nullable: false),
                    Key = table.Column<string>(type: "TEXT", nullable: false),
                    RuleVersion = table.Column<string>(type: "TEXT", nullable: false),
                    AwardScope = table.Column<string>(type: "TEXT", nullable: false),
                    SeasonId = table.Column<Guid>(type: "TEXT", nullable: true),
                    EarnedAtUtc = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    SessionId = table.Column<Guid>(type: "TEXT", nullable: false),
                    EvidenceJson = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SoloBadgeAwards", x => new { x.OrganizationId, x.StudentUserId, x.Key, x.RuleVersion, x.AwardScope });
                });

            migrationBuilder.CreateTable(
                name: "TrainingDays",
                columns: table => new
                {
                    OrganizationId = table.Column<Guid>(type: "TEXT", nullable: false),
                    StudentUserId = table.Column<Guid>(type: "TEXT", nullable: false),
                    LocalDate = table.Column<string>(type: "TEXT", nullable: false),
                    TimeZone = table.Column<string>(type: "TEXT", nullable: false),
                    WeekStartLocalDate = table.Column<string>(type: "TEXT", nullable: false),
                    CreditedAtUtc = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    SessionId = table.Column<Guid>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TrainingDays", x => new { x.OrganizationId, x.StudentUserId, x.LocalDate });
                });

            migrationBuilder.CreateTable(
                name: "TrainingPreferences",
                columns: table => new
                {
                    OrganizationId = table.Column<Guid>(type: "TEXT", nullable: false),
                    StudentUserId = table.Column<Guid>(type: "TEXT", nullable: false),
                    PreferencesJson = table.Column<string>(type: "TEXT", nullable: false),
                    LastEventAtUtc = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    Revision = table.Column<int>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TrainingPreferences", x => new { x.OrganizationId, x.StudentUserId });
                });

            migrationBuilder.CreateTable(
                name: "TrainingSeasonProgress",
                columns: table => new
                {
                    OrganizationId = table.Column<Guid>(type: "TEXT", nullable: false),
                    StudentUserId = table.Column<Guid>(type: "TEXT", nullable: false),
                    SeasonId = table.Column<Guid>(type: "TEXT", nullable: false),
                    ScopeVersion = table.Column<string>(type: "TEXT", nullable: false),
                    SeenIdsJson = table.Column<string>(type: "TEXT", nullable: false),
                    BadgesJson = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TrainingSeasonProgress", x => new { x.OrganizationId, x.StudentUserId, x.SeasonId, x.ScopeVersion });
                });

            migrationBuilder.CreateTable(
                name: "TrainingWeeks",
                columns: table => new
                {
                    OrganizationId = table.Column<Guid>(type: "TEXT", nullable: false),
                    StudentUserId = table.Column<Guid>(type: "TEXT", nullable: false),
                    WeekStartLocalDate = table.Column<string>(type: "TEXT", nullable: false),
                    TimeZone = table.Column<string>(type: "TEXT", nullable: false),
                    Target = table.Column<int>(type: "INTEGER", nullable: false),
                    CompletedDays = table.Column<int>(type: "INTEGER", nullable: false),
                    QualifiedAtUtc = table.Column<DateTimeOffset>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TrainingWeeks", x => new { x.OrganizationId, x.StudentUserId, x.WeekStartLocalDate });
                });

            migrationBuilder.CreateIndex(
                name: "IX_StudySessions_OrganizationId_StudentUserId_ClientStartId",
                table: "StudySessions",
                columns: new[] { "OrganizationId", "StudentUserId", "ClientStartId" },
                unique: true,
                filter: "\"ClientStartId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_DailyMissions_OrganizationId_StudentUserId_SeasonId_LocalDate_Revision",
                table: "DailyMissions",
                columns: new[] { "OrganizationId", "StudentUserId", "SeasonId", "LocalDate", "Revision" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "DailyMissions");

            migrationBuilder.DropTable(
                name: "SoloBadgeAwards");

            migrationBuilder.DropTable(
                name: "TrainingDays");

            migrationBuilder.DropTable(
                name: "TrainingPreferences");

            migrationBuilder.DropTable(
                name: "TrainingSeasonProgress");

            migrationBuilder.DropTable(
                name: "TrainingWeeks");

            migrationBuilder.DropIndex(
                name: "IX_StudySessions_OrganizationId_StudentUserId_ClientStartId",
                table: "StudySessions");

            migrationBuilder.DropColumn(
                name: "ClientStartId",
                table: "StudySessions");

            migrationBuilder.DropColumn(
                name: "RecapJson",
                table: "StudySessions");

            migrationBuilder.DropColumn(
                name: "StartPayloadJson",
                table: "StudySessions");

            migrationBuilder.DropColumn(
                name: "TrainingJson",
                table: "StudySessions");

            migrationBuilder.DropColumn(
                name: "LastAttemptId",
                table: "MasteryStates");

            migrationBuilder.DropColumn(
                name: "AfterSkillsJson",
                table: "Attempts");

            migrationBuilder.DropColumn(
                name: "BeforeSkillsJson",
                table: "Attempts");

            migrationBuilder.DropColumn(
                name: "PreviousAttemptId",
                table: "Attempts");
        }
    }
}
