using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Erudoza.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class PbeTeamPractice : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "PracticeQuestionRecord",
                columns: table => new
                {
                    Id = table.Column<Guid>(nullable: false),
                    OrganizationId = table.Column<Guid>(nullable: false),
                    SeasonId = table.Column<Guid>(nullable: false),
                    QuestionKey = table.Column<Guid>(nullable: false),
                    Version = table.Column<int>(nullable: false),
                    Published = table.Column<bool>(nullable: false),
                    DefinitionJson = table.Column<string>(nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PracticeQuestionRecord", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "PracticeRoomRecord",
                columns: table => new
                {
                    Id = table.Column<Guid>(nullable: false),
                    OrganizationId = table.Column<Guid>(nullable: false),
                    SeasonId = table.Column<Guid>(nullable: false),
                    Status = table.Column<string>(maxLength: 24, nullable: false),
                    Revision = table.Column<long>(nullable: false),
                    StateJson = table.Column<string>(nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PracticeRoomRecord", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "PracticeSetting",
                columns: table => new
                {
                    OrganizationId = table.Column<Guid>(nullable: false),
                    Enabled = table.Column<bool>(nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PracticeSetting", x => x.OrganizationId);
                });

            migrationBuilder.CreateIndex(
                name: "IX_PracticeQuestionRecord_OrganizationId_QuestionKey_Version",
                table: "PracticeQuestionRecord",
                columns: new[] { "OrganizationId", "QuestionKey", "Version" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PracticeRoomRecord_OrganizationId_Status",
                table: "PracticeRoomRecord",
                columns: new[] { "OrganizationId", "Status" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PracticeQuestionRecord");

            migrationBuilder.DropTable(
                name: "PracticeRoomRecord");

            migrationBuilder.DropTable(
                name: "PracticeSetting");
        }
    }
}
