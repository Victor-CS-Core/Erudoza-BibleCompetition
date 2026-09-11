using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Erudoza.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class BuiltInNkjvLibrary : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "IsBuiltIn",
                table: "ContentPacks",
                type: ActiveProvider.Contains("SqlServer", StringComparison.Ordinal) ? "bit" : "INTEGER",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "IsBuiltIn",
                table: "ContentPacks");
        }
    }
}
