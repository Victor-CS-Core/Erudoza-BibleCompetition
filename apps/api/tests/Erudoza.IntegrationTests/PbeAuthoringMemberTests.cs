using System.Data.SqlTypes;
using System.Net.Http.Json;
using System.Reflection;
using System.Text.Json;
using System.Text.RegularExpressions;
using Erudoza.Api.Practice;
using Erudoza.Domain;
using Erudoza.Infrastructure;
using Erudoza.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Erudoza.IntegrationTests;

public sealed class PbeAuthoringMemberTests
{
    private static Guid[] MemberIds() => Enumerable.Range(0, 205)
        .Select(i => Guid.Parse($"{0xa00 + i:x8}-0000-0000-0000-{0x1000 - i:x12}")).ToArray();

    [Fact]
    public void Configured_SqlServer_member_query_orders_by_the_same_text_expression_as_its_cursor()
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Database:Provider"] = "SqlServer",
            ["Database:ConnectionString"] = "Server=localhost;Database=TranslationOnly;Integrated Security=True;TrustServerCertificate=True"
        }).Build();
        using var services = new ServiceCollection().AddErudozaInfrastructure(configuration).BuildServiceProvider();
        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
        Assert.Equal("Microsoft.EntityFrameworkCore.SqlServer", db.Database.ProviderName);
        var service = new PracticeService(db, null!, configuration);
        // Inspect the exact private query used by the HTTP service, not a test's copy.
        var method = typeof(PracticeService).GetMethod("PbeMemberPage", BindingFlags.Instance | BindingFlags.NonPublic)!;
        var query = (IQueryable)method.Invoke(service, [Guid.NewGuid(), Guid.NewGuid(), MemberIds()[99].ToString()])!;
        var sql = query.ToQueryString();
        var cursorExpression = Regex.Match(sql, @"(?:LOWER\()?CONVERT\(varchar\(36\), \[[^\]]+\]\.\[Id\]\)\)?").Value;
        Assert.NotEmpty(cursorExpression);
        Assert.Contains("ORDER BY " + cursorExpression, sql);
        Assert.StartsWith("LOWER(", cursorExpression);
        Assert.Contains("TOP(", sql);
        var ids = MemberIds();
        Assert.False(ids.SequenceEqual(ids.OrderBy(id => new SqlGuid(id))));
        // Witness why the old SQL ordering plus textual cursor cannot traverse this set.
        var oldFirstPage = ids.OrderBy(id => new SqlGuid(id)).Take(100).ToArray();
        var oldRemaining = ids.Where(id => string.CompareOrdinal(id.ToString(), oldFirstPage[^1].ToString()) > 0);
        Assert.True(oldFirstPage.Concat(oldRemaining).Distinct().Count() < ids.Length);
    }

    [Fact]
    public async Task Authoring_member_pages_visit_every_eligible_member_once_and_canonicalize_cursors()
    {
        using var factory = new ErudozaApiFactory { DisablePracticeTicker = true };
        using var coach = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        var me = await coach.GetFromJsonAsync<JsonElement>("/api/v1/me");
        var org = me.GetProperty("organizationId").GetGuid();
        using var services = factory.Services.CreateScope();
        var db = services.ServiceProvider.GetRequiredService<ErudozaDbContext>();
        var rule = new RuleProfile { Id = Guid.NewGuid(), Key = "pbe-member-pages", Version = 1 };
        var season = new CompetitionSeason { Id = Guid.NewGuid(), OrganizationId = org, RuleProfileId = rule.Id, Status = SeasonStatus.Active };
        var otherOrg = new Organization { Id = Guid.NewGuid(), Name = "Other fixture", Slug = "pbe-other-fixture" };
        var otherSeason = new CompetitionSeason { Id = Guid.NewGuid(), OrganizationId = org, RuleProfileId = rule.Id, Status = SeasonStatus.Active };
        db.RuleProfiles.Add(rule); db.Seasons.AddRange(season, otherSeason); db.Organizations.Add(otherOrg);
        var expected = MemberIds();
        var excluded = Enumerable.Range(0, 5).Select(i => Guid.Parse($"{0xb00 + i:x8}-0000-0000-0000-000000000001")).ToArray();
        foreach (var id in expected.Concat(excluded))
        {
            var exclusion = Array.IndexOf(excluded, id);
            var userOrg = exclusion == 3 ? otherOrg.Id : org;
            db.Users.Add(new ApplicationUser { Id = id, UserName = "pbe-member-" + id, DisplayName = "Member " + id, Kind = exclusion == 1 ? UserKind.Adult : UserKind.Student, IsActive = exclusion != 0 });
            db.OrganizationMembers.Add(new OrganizationMember { Id = Guid.NewGuid(), OrganizationId = userOrg, UserId = id, Role = exclusion == 2 ? OrganizationRole.Admin : OrganizationRole.Student });
            db.CompetitionMembers.Add(new CompetitionMember { Id = Guid.NewGuid(), OrganizationId = userOrg, SeasonId = exclusion == 4 ? otherSeason.Id : season.Id, UserId = id });
        }
        await db.SaveChangesAsync();
        var path = $"/api/v1/organizations/{org}/practice/pbe/seasons/{season.Id}/authoring";
        var found = new List<Guid>(); var cursor = ""; var pageSizes = new List<int>();
        for (var page = 0; page < 3; page++)
        {
            var result = await coach.GetFromJsonAsync<JsonElement>(path + "?membersAfter=" + cursor);
            var members = result.GetProperty("members").EnumerateArray().Select(m => m.GetProperty("id").GetGuid()).ToList();
            var uppercase = await coach.GetFromJsonAsync<JsonElement>(path + "?membersAfter=" + cursor.ToUpperInvariant());
            Assert.Equal(members, uppercase.GetProperty("members").EnumerateArray().Select(m => m.GetProperty("id").GetGuid()).ToList());
            pageSizes.Add(members.Count); found.AddRange(members);
            var next = result.GetProperty("membersNextCursor");
            if (page == 2) Assert.Equal(JsonValueKind.Null, next.ValueKind);
            else { cursor = next.GetString()!; Assert.Equal(members[^1].ToString(), cursor); }
        }
        Assert.Equal(new[] { 100, 100, 5 }, pageSizes);
        Assert.Equal(expected, found);
        Assert.Equal(205, found.Distinct().Count());
        Assert.DoesNotContain(found, id => excluded.Contains(id));
    }
}
