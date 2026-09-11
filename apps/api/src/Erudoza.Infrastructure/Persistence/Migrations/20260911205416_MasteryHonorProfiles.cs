using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Erudoza.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class MasteryHonorProfiles : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "MasteryHonorUnlocks",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    OrganizationId = table.Column<Guid>(type: "TEXT", nullable: false),
                    UserId = table.Column<Guid>(type: "TEXT", nullable: false),
                    Key = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false),
                    RuleVersion = table.Column<string>(type: "TEXT", maxLength: 32, nullable: false),
                    SeasonId = table.Column<Guid>(type: "TEXT", nullable: false),
                    EarnedAtUtc = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    EvidenceJson = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MasteryHonorUnlocks", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "MasteryPassageProofs",
                columns: table => new
                {
                    OrganizationId = table.Column<Guid>(type: "TEXT", nullable: false),
                    UserId = table.Column<Guid>(type: "TEXT", nullable: false),
                    SeasonId = table.Column<Guid>(type: "TEXT", nullable: false),
                    KnowledgeUnitId = table.Column<Guid>(type: "TEXT", nullable: false),
                    RuleVersion = table.Column<string>(type: "TEXT", maxLength: 32, nullable: false),
                    FirstMasteredAtUtc = table.Column<DateTimeOffset>(type: "TEXT", nullable: true),
                    FirstMasteredEvidenceJson = table.Column<string>(type: "TEXT", nullable: true),
                    RetainedEvidenceJson = table.Column<string>(type: "TEXT", nullable: true),
                    ReviewedEvidenceJson = table.Column<string>(type: "TEXT", nullable: true),
                    FirstMasteredAttemptId = table.Column<Guid>(type: "TEXT", nullable: true),
                    RetainedAttemptId = table.Column<Guid>(type: "TEXT", nullable: true),
                    RetainedAtUtc = table.Column<DateTimeOffset>(type: "TEXT", nullable: true),
                    ReviewedAttemptId = table.Column<Guid>(type: "TEXT", nullable: true),
                    ReviewedAtUtc = table.Column<DateTimeOffset>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MasteryPassageProofs", x => new { x.OrganizationId, x.UserId, x.SeasonId, x.KnowledgeUnitId, x.RuleVersion });
                });

            migrationBuilder.CreateTable(
                name: "ProfileAvatarSelections",
                columns: table => new
                {
                    OrganizationId = table.Column<Guid>(type: "TEXT", nullable: false),
                    UserId = table.Column<Guid>(type: "TEXT", nullable: false),
                    UnlockId = table.Column<Guid>(type: "TEXT", nullable: true),
                    HonorKey = table.Column<string>(type: "TEXT", maxLength: 64, nullable: true),
                    RuleVersion = table.Column<string>(type: "TEXT", maxLength: 32, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProfileAvatarSelections", x => new { x.OrganizationId, x.UserId });
                });

            migrationBuilder.CreateIndex(
                name: "IX_MasteryHonorUnlocks_OrganizationId_UserId_Key_RuleVersion",
                table: "MasteryHonorUnlocks",
                columns: new[] { "OrganizationId", "UserId", "Key", "RuleVersion" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "MasteryHonorUnlocks");

            migrationBuilder.DropTable(
                name: "MasteryPassageProofs");

            migrationBuilder.DropTable(
                name: "ProfileAvatarSelections");
        }
    }
}
