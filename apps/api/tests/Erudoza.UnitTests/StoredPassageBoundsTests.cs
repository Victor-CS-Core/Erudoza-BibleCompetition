using Erudoza.Application.Content;
using Erudoza.Application.Contracts;
using Erudoza.Domain;
using FluentAssertions;

namespace Erudoza.UnitTests;

public sealed class StoredPassageBoundsTests
{
    [Fact]
    public void Existing_endpoints_do_not_hide_a_missing_interior_verse()
    {
        var validate = () => StoredPassageBounds.RequireRange(new("GEN", 1, 1, 1, 3), [Unit(1, 1), Unit(1, 3)]);
        validate.Should().Throw<DomainException>().WithMessage("*unavailable verse*");
    }

    [Fact]
    public void Existing_endpoints_do_not_hide_a_missing_intermediate_chapter()
    {
        var validate = () => StoredPassageBounds.RequireRange(new("GEN", 1, 2, 3, 1), [Unit(1, 1), Unit(1, 2), Unit(3, 1)]);
        validate.Should().Throw<DomainException>().WithMessage("*unavailable chapter*");
    }

    [Fact]
    public void Cross_chapter_ranges_include_only_the_intended_boundary_verses()
    {
        var selected = StoredPassageBounds.RequireRange(new("GEN", 1, 2, 2, 1), [Unit(1, 1), Unit(1, 2), Unit(2, 1), Unit(2, 2)]);
        selected.Select(u => (u.Chapter, u.Verse)).Should().Equal((1, 2), (2, 1));
    }

    private static SourceUnit Unit(int chapter, int verse) => new() { BookKey = "GEN", Chapter = chapter, Verse = verse };
}
