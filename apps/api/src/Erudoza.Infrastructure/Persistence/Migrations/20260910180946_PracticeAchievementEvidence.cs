using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Erudoza.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class PracticeAchievementEvidence : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "PracticeAwardRecord",
                columns: table => new
                {
                    OrganizationId = table.Column<Guid>(nullable: false),
                    SeasonId = table.Column<Guid>(nullable: false),
                    UserId = table.Column<Guid>(nullable: false),
                    Key = table.Column<string>(maxLength: 64, nullable: false),
                    Title = table.Column<string>(maxLength: 100, nullable: false),
                    ReconciledAt = table.Column<DateTimeOffset>(nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PracticeAwardRecord", x => new { x.OrganizationId, x.SeasonId, x.UserId, x.Key });
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PracticeAwardRecord");
        }
    }
}
