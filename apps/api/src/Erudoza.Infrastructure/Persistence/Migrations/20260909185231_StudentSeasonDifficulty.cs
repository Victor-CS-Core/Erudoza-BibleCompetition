using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Erudoza.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class StudentSeasonDifficulty : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Attempts_ChallengeCardId",
                table: "Attempts");

            migrationBuilder.AddColumn<int>(
                name: "Difficulty",
                table: "StudySessions",
                nullable: false,
                defaultValue: 3);

            migrationBuilder.AddColumn<string>(
                name: "DifficultyPolicyVersion",
                table: "StudySessions",
                nullable: false,
                defaultValue: "v1");

            migrationBuilder.AddColumn<string>(
                name: "RuleProfileSnapshotJson",
                table: "StudySessions",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<int>(
                name: "Difficulty",
                table: "CompetitionMembers",
                nullable: false,
                defaultValue: 3);

            migrationBuilder.AddColumn<Guid>(
                name: "AnswerSourceUnitId",
                table: "ChallengeCards",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsLegacyDuplicate",
                table: "Attempts",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "ResultJson",
                table: "Attempts",
                nullable: true);

            // Preserve historical attempts while enforcing one scored attempt per card.
            migrationBuilder.Sql("""
                UPDATE Attempts SET IsLegacyDuplicate = 1 WHERE Id IN (
                    SELECT Id FROM (
                        SELECT Id, ROW_NUMBER() OVER (PARTITION BY ChallengeCardId ORDER BY CreatedAtUtc, Id) AS DuplicateRank
                        FROM Attempts
                    ) ranked WHERE DuplicateRank > 1
                );
                """);

            migrationBuilder.CreateIndex(
                name: "IX_CompetitionMembers_OrganizationId_SeasonId_UserId",
                table: "CompetitionMembers",
                columns: new[] { "OrganizationId", "SeasonId", "UserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Attempts_ChallengeCardId",
                table: "Attempts",
                column: "ChallengeCardId",
                unique: true,
                filter: "[IsLegacyDuplicate] = 0");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_CompetitionMembers_OrganizationId_SeasonId_UserId",
                table: "CompetitionMembers");

            migrationBuilder.DropIndex(
                name: "IX_Attempts_ChallengeCardId",
                table: "Attempts");

            migrationBuilder.DropColumn(
                name: "Difficulty",
                table: "StudySessions");

            migrationBuilder.DropColumn(
                name: "DifficultyPolicyVersion",
                table: "StudySessions");

            migrationBuilder.DropColumn(
                name: "RuleProfileSnapshotJson",
                table: "StudySessions");

            migrationBuilder.DropColumn(
                name: "Difficulty",
                table: "CompetitionMembers");

            migrationBuilder.DropColumn(
                name: "AnswerSourceUnitId",
                table: "ChallengeCards");

            migrationBuilder.DropColumn(
                name: "IsLegacyDuplicate",
                table: "Attempts");

            migrationBuilder.DropColumn(
                name: "ResultJson",
                table: "Attempts");

            migrationBuilder.CreateIndex(
                name: "IX_Attempts_ChallengeCardId",
                table: "Attempts",
                column: "ChallengeCardId");
        }
    }
}
