using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Erudoza.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class PbeTrainingRecords : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            var sqlServer = ActiveProvider == "Microsoft.EntityFrameworkCore.SqlServer";
            migrationBuilder.AddColumn<bool>(
                name: "PbeEnabled",
                table: "Seasons",
                type: sqlServer ? "bit" : "INTEGER",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "PbeTrainingRecords",
                columns: table => new
                {
                    OrganizationId = table.Column<Guid>(type: sqlServer ? "uniqueidentifier" : "TEXT", nullable: false),
                    Kind = table.Column<string>(type: sqlServer ? "nvarchar(100)" : "TEXT", maxLength: 100, nullable: false),
                    Id = table.Column<string>(type: sqlServer ? "nvarchar(200)" : "TEXT", maxLength: 200, nullable: false),
                    SeasonId = table.Column<Guid>(type: sqlServer ? "uniqueidentifier" : "TEXT", nullable: false),
                    OwnerId = table.Column<Guid>(type: sqlServer ? "uniqueidentifier" : "TEXT", nullable: true),
                    DataJson = table.Column<string>(type: sqlServer ? "nvarchar(max)" : "TEXT", nullable: false),
                    Revision = table.Column<long>(type: sqlServer ? "bigint" : "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PbeTrainingRecords", x => new { x.OrganizationId, x.Kind, x.Id });
                });

            migrationBuilder.CreateIndex(
                name: "IX_PbeTrainingRecords_OrganizationId_SeasonId_OwnerId_Kind",
                table: "PbeTrainingRecords",
                columns: new[] { "OrganizationId", "SeasonId", "OwnerId", "Kind" });

            migrationBuilder.CreateIndex(
                name: "IX_PbeTrainingRecords_OrganizationId_SeasonId_OwnerId_Kind_Id",
                table: "PbeTrainingRecords",
                columns: new[] { "OrganizationId", "SeasonId", "OwnerId", "Kind", "Id" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PbeTrainingRecords");

            migrationBuilder.DropColumn(
                name: "PbeEnabled",
                table: "Seasons");
        }
    }
}
