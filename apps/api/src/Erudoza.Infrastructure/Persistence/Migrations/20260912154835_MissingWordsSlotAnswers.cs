using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Erudoza.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class MissingWordsSlotAnswers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "AnswerPayloadJson",
                table: "Attempts",
                type: ActiveProvider == "Microsoft.EntityFrameworkCore.SqlServer" ? "nvarchar(max)" : "TEXT",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AnswerPayloadJson",
                table: "Attempts");
        }
    }
}
