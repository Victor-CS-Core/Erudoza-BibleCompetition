using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Application.Study;
using Erudoza.Domain;
using Erudoza.Domain.Practice;
using Erudoza.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Erudoza.IntegrationTests;

public sealed class PbeQuestionBankTests
{
    [Theory]
    [InlineData("citation")]
    [InlineData("pack-type")]
    public async Task Source_validation_field_changes_during_load_conflict(string field)
    {
        using var factory = new ErudozaApiFactory { DisablePracticeTicker = true };
        using var coach = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        var me = await coach.GetFromJsonAsync<JsonElement>("/api/v1/me");
        var org = me.GetProperty("organizationId").GetGuid();
        using var services = factory.Services.CreateScope();
        var db = services.ServiceProvider.GetRequiredService<ErudozaDbContext>();
        var source = await db.SourceUnits.Include(s => s.ContentPack).FirstAsync(s => s.OrganizationId == org);
        var rule = new RuleProfile { Id = Guid.NewGuid(), Key = "pbe-field-edit", Version = 1 };
        var season = new CompetitionSeason { Id = Guid.NewGuid(), OrganizationId = org, RuleProfileId = rule.Id, Status = SeasonStatus.Active };
        db.RuleProfiles.Add(rule); db.Seasons.Add(season);
        db.ScopeEntries.Add(new() { Id = Guid.NewGuid(), OrganizationId = org, SeasonId = season.Id, ContentPackId = source.ContentPackId, Kind = ScopeEntryKind.Include, BookKey = source.BookKey, StartChapter = source.Chapter, EndChapter = source.Chapter, StartVerse = source.Verse, EndVerse = source.Verse });
        var target = new PbeTarget { Id = Guid.NewGuid(), SourceUnitIds = [source.Id], Skill = RecallSkill.FactualRecall, Label = "Source-backed label" };
        var question = new PbeQuestion { SchemaVersion = 2, Id = Guid.NewGuid(), Version = 1, ContentPackId = source.ContentPackId, SourceUnitId = source.Id, SourceUnitIds = [source.Id], SourceKind = PbeSourceKind.Scripture, Reference = source.CitationLabel, Evidence = source.CanonicalText, Kind = PbeQuestionKind.ShortAnswer, Prompt = "Name the label.", Parts = [new() { TargetId = target.Id, AcceptedAnswers = ["label"], Points = 1 }] };
        var proof = PbeQuestionBank.SourceProof(question, new Dictionary<Guid, SourceUnit> { [source.Id] = source });
        db.PbeTrainingRecords.Add(new() { OrganizationId = org, SeasonId = season.Id, Kind = "pbe-target", Id = target.Id.ToString(), OwnerId = source.Id, DataJson = JsonSerializer.Serialize(target, PbeQuestionBank.Json) });
        db.PbeTrainingRecords.Add(new() { OrganizationId = org, SeasonId = season.Id, Kind = "pbe-question-head", Id = question.Id.ToString(), OwnerId = source.Id, DataJson = JsonSerializer.Serialize(new PbeBankQuestionData($"{question.Id}:1", season.Id, true, question, proof), PbeQuestionBank.Json) });
        await db.SaveChangesAsync();
        var user = new BankUser(me.GetProperty("userId").GetGuid(), org);
        var resolver = services.ServiceProvider.GetRequiredService<ICompetitionScopeResolver>();
        var assignments = services.ServiceProvider.GetRequiredService<IStudentStudyScopeService>();
        var scope = new PbeBankScope(org, season.Id, null, [source.Id]);
        Assert.Single((await new PbeQuestionBank(db, user, resolver, assignments).LoadAsync(scope)).Questions);
        var editing = new EditingResolver(resolver, async () =>
        {
            if (field == "citation") source.CitationLabel += " revised";
            else source.ContentPack!.SourceType = SourceType.Supplemental;
            await db.SaveChangesAsync();
        });
        await Assert.ThrowsAsync<PbeBankConflictException>(() => new PbeQuestionBank(db, user, editing, assignments).LoadAsync(scope));
    }

    [Fact]
    public void Source_fingerprint_and_NFC_excerpt_match_native_literal()
    {
        var id = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000003");
        var q = new PbeQuestion { SourceUnitIds = [id], Reference = "GEN 1:1", Evidence = "Cafe\u0301\t🌿" };
        var source = new SourceUnit { Id = id, CanonicalText = "Café 🌿 Alpha", CitationLabel = "GEN 1:1" };
        Assert.Equal("b657f4d84fadbb1f26738ee662e9a76a3e6a828e6ed8126cbc13c1d08bf2b0fb", PbeQuestionBank.SourceProof(q, new Dictionary<Guid, SourceUnit> { [id] = source }));
    }
    [Fact]
    public async Task Coach_can_prepare_before_team_opt_in_and_students_get_only_assigned_counts()
    {
        using var factory = new ErudozaApiFactory { DisablePracticeTicker = true };
        using var coach = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        using var student = await TestHttp.LoginAsync(factory, "daniel.student", "DevStudent!234");
        var me = await coach.GetFromJsonAsync<JsonElement>("/api/v1/me");
        var org = me.GetProperty("organizationId").GetGuid();
        using var services = factory.Services.CreateScope();
        var db = services.ServiceProvider.GetRequiredService<ErudozaDbContext>();
        var rule = new RuleProfile { Id = Guid.NewGuid(), Key = "pbe-test", Version = 1 }; db.RuleProfiles.Add(rule);
        var season = new CompetitionSeason { Id = Guid.NewGuid(), OrganizationId = org, RuleProfileId = rule.Id }; db.Seasons.Add(season);
        season.Status = SeasonStatus.Active;
        var sources = await db.SourceUnits.Where(s => s.OrganizationId == org).OrderBy(s => s.Ordinal).Take(2).ToListAsync();
        var a = sources[0]; var b = sources[1];
        db.ScopeEntries.RemoveRange(await db.ScopeEntries.Where(s => s.SeasonId == season.Id).ToListAsync());
        db.ScopeEntries.Add(new CompetitionScopeEntry { Id = Guid.NewGuid(), OrganizationId = org, SeasonId = season.Id, ContentPackId = a.ContentPackId, Kind = ScopeEntryKind.Include, BookKey = a.BookKey, StartChapter = a.Chapter, StartVerse = a.Verse, EndChapter = b.Chapter, EndVerse = b.Verse });
        var studentId = (await student.GetFromJsonAsync<JsonElement>("/api/v1/me")).GetProperty("userId").GetGuid();
        db.Assignments.RemoveRange(await db.Assignments.Where(s => s.SeasonId == season.Id).ToListAsync());
        db.Assignments.Add(new Assignment { Id = Guid.NewGuid(), OrganizationId = org, SeasonId = season.Id, StudentUserId = studentId, Type = AssignmentType.RequiredCoverage, Scopes = [new AssignmentScope { Id = Guid.NewGuid(), ContentPackId = a.ContentPackId, BookKey = a.BookKey, StartChapter = a.Chapter, EndChapter = a.Chapter, StartVerse = a.Verse, EndVerse = a.Verse }] });
        await db.SaveChangesAsync();
        var path = $"/api/v1/organizations/{org}/practice/pbe/seasons/{season.Id}";
        var qid = Guid.NewGuid(); var tid = Guid.NewGuid();
        var question = new { schemaVersion = 2, id = qid, version = 1, contentPackId = a.ContentPackId, sourceUnitId = a.Id, sourceUnitIds = new[] { a.Id, b.Id }, sourceKind = "Scripture", reference = $"{a.CitationLabel}; {b.CitationLabel}", evidence = a.CanonicalText, kind = "ShortAnswer", prompt = "Name both labels.", ordered = false, parts = new[] { new { targetId = tid, acceptedAnswers = new[] { "Alpha and Beta" }, points = 1 } } };
        var input = new { questions = new[] { question }, targets = new[] { new { id = tid, sourceUnitIds = new[] { a.Id, b.Id }, skill = "FactualRecall", label = "Both labels" } } };
        foreach (var blank in new[] { "\ufeff", "\u0085" }) foreach (var field in new[] { "prompt", "evidence", "label" })
        {
            var unicode = System.Text.Json.Nodes.JsonNode.Parse(JsonSerializer.Serialize(input))!;
            if (field == "label") unicode["targets"]![0]![field] = blank;
            else unicode["questions"]![0]![field] = blank;
            Assert.Equal(HttpStatusCode.BadRequest, (await coach.PostAsJsonAsync(path + "/questions/import", unicode)).StatusCode);
        }
        Assert.Equal(HttpStatusCode.BadRequest, (await coach.PostAsJsonAsync(path + "/targets", new { targets = new object?[] { null } })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await coach.PostAsJsonAsync(path + "/targets", new { targets = input.targets })).StatusCode);
        Assert.Single((await coach.GetFromJsonAsync<JsonElement>(path + "/targets?limit=1")).GetProperty("items").EnumerateArray());
        Assert.Equal(HttpStatusCode.OK, (await coach.GetAsync(path + "/authoring")).StatusCode);
        foreach (var endpoint in new[] { "/authoring", "/targets", "/questions" }) Assert.Equal(HttpStatusCode.Forbidden, (await student.GetAsync(path + endpoint)).StatusCode);
        var malformed = System.Text.Json.Nodes.JsonNode.Parse(JsonSerializer.Serialize(input))!;
        foreach (var invalid in new[] { "null", "{\"schemaVersion\":2}" })
        {
            malformed["questions"]![0] = System.Text.Json.Nodes.JsonNode.Parse(invalid);
            Assert.Equal(HttpStatusCode.BadRequest, (await coach.PostAsJsonAsync(path + "/questions/import", malformed)).StatusCode);
        }
        malformed = System.Text.Json.Nodes.JsonNode.Parse(JsonSerializer.Serialize(input))!;
        malformed["questions"]![0]!["version"] = "1";
        Assert.Equal(HttpStatusCode.BadRequest, (await coach.PostAsJsonAsync(path + "/questions/import", malformed)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await coach.PostAsJsonAsync(path + "/questions/import", input)).StatusCode);
        var versionBoundary = System.Text.Json.Nodes.JsonNode.Parse(JsonSerializer.Serialize(input))!;
        versionBoundary["questions"]![0]!["version"] = int.MaxValue;
        Assert.Equal(HttpStatusCode.NoContent, (await coach.PostAsJsonAsync(path + "/questions/import", versionBoundary)).StatusCode);
        versionBoundary["questions"]![0]!["version"] = (long)int.MaxValue + 1;
        Assert.Equal(HttpStatusCode.BadRequest, (await coach.PostAsJsonAsync(path + "/questions/import", versionBoundary)).StatusCode);
        Assert.Equal(0, (await coach.GetFromJsonAsync<JsonElement>(path + "/bank")).GetProperty("questionCount").GetInt32());
        Assert.Equal(HttpStatusCode.NoContent, (await coach.PostAsJsonAsync(path + $"/questions/{qid}/1/publish", new { })).StatusCode);
        Assert.Equal(1, (await coach.GetFromJsonAsync<JsonElement>(path + "/bank")).GetProperty("questionCount").GetInt32());
        Assert.Equal(HttpStatusCode.Forbidden, (await student.GetAsync(path + "/bank")).StatusCode);
        (await coach.PostAsJsonAsync(path + "/enabled", new { enabled = true })).EnsureSuccessStatusCode();
        var result = await student.GetStringAsync(path + "/bank");
        Assert.Equal(0, JsonDocument.Parse(result).RootElement.GetProperty("questionCount").GetInt32());
        Assert.DoesNotContain("acceptedAnswers", result); Assert.DoesNotContain("evidence", result); Assert.DoesNotContain("Alpha", result);
        Assert.Equal(HttpStatusCode.Forbidden, (await student.PostAsJsonAsync(path + "/questions/import", input)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await coach.GetAsync(path.Replace(org.ToString(), Guid.NewGuid().ToString()) + "/bank")).StatusCode);
        var assignment = await db.AssignmentScopes.SingleAsync(s => s.Assignment!.SeasonId == season.Id);
        assignment.EndChapter = b.Chapter; assignment.EndVerse = b.Verse; await db.SaveChangesAsync();
        Assert.Equal(1, (await student.GetFromJsonAsync<JsonElement>(path + "/bank")).GetProperty("questionCount").GetInt32());
        db.Assignments.RemoveRange(await db.Assignments.Where(s => s.SeasonId == season.Id).ToListAsync()); await db.SaveChangesAsync();
        Assert.Equal(0, (await student.GetFromJsonAsync<JsonElement>(path + "/bank")).GetProperty("questionCount").GetInt32());
        var pack = await db.ContentPacks.SingleAsync(p => p.Id == a.ContentPackId); pack.LicensingStatus = "pending"; await db.SaveChangesAsync();
        Assert.Equal(0, (await coach.GetFromJsonAsync<JsonElement>(path + "/bank")).GetProperty("questionCount").GetInt32());
        pack.LicensingStatus = "development-sample"; await db.SaveChangesAsync();
        (await coach.PostAsJsonAsync($"/api/v1/organizations/{org}/practice/enabled", new { enabled = true })).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.BadRequest, (await coach.PostAsJsonAsync($"/api/v1/organizations/{org}/practice/questions/import", new { seasonId = season.Id, questions = new[] { question } })).StatusCode);
        Assert.Empty((await coach.GetFromJsonAsync<JsonElement>($"/api/v1/organizations/{org}/practice/bootstrap")).GetProperty("questions").EnumerateArray());
        var saved = a.CanonicalText; a.CanonicalText += " additional text"; await db.SaveChangesAsync();
        Assert.Equal(0, (await coach.GetFromJsonAsync<JsonElement>(path + "/bank")).GetProperty("questionCount").GetInt32());
        a.CanonicalText = saved; await db.SaveChangesAsync();
        var privateQuestion = JsonSerializer.Deserialize<PbeQuestion>(JsonSerializer.Serialize(question), PbeQuestionBank.Json)!;
        var proof = PbeQuestionBank.SourceProof(privateQuestion, sources.ToDictionary(s => s.Id));
        for (var index = 0; index < 5101; index++)
        {
            var q = JsonSerializer.Deserialize<PbeQuestion>(JsonSerializer.Serialize(question), PbeQuestionBank.Json)!;
            q.Id = Guid.NewGuid(); var targetId = Guid.NewGuid(); q.Parts[0].TargetId = targetId;
            var t = new PbeTarget { Id = targetId, SourceUnitIds = [a.Id, b.Id], Skill = RecallSkill.FactualRecall, Label = "Both" };
            var key = $"{q.Id}:1";
            db.PbeTrainingRecords.Add(new() { OrganizationId = org, SeasonId = season.Id, Kind = "pbe-question-head", OwnerId = a.Id, Id = q.Id.ToString(), DataJson = JsonSerializer.Serialize(new PbeBankQuestionData(key, season.Id, true, q, proof), PbeQuestionBank.Json) });
            db.PbeTrainingRecords.Add(new() { OrganizationId = org, SeasonId = season.Id, Kind = "pbe-target", OwnerId = a.Id, Id = targetId.ToString(), DataJson = JsonSerializer.Serialize(t, PbeQuestionBank.Json) });
        }
        await db.SaveChangesAsync();
        Assert.Equal(5102, (await coach.GetFromJsonAsync<JsonElement>(path + "/bank")).GetProperty("questionCount").GetInt32());
        for (var index = 0; index < 10000; index++) db.PbeTrainingRecords.Add(new() { OrganizationId = org, SeasonId = season.Id, OwnerId = studentId, Kind = "pbe-progress", Id = index.ToString() });
        await db.SaveChangesAsync();
        Assert.Equal(5102, (await coach.GetFromJsonAsync<JsonElement>(path + "/bank")).GetProperty("questionCount").GetInt32());
        var connection = db.Database.GetDbConnection(); await connection.OpenAsync();
        await using (var command = connection.CreateCommand())
        {
            command.CommandText = "EXPLAIN QUERY PLAN SELECT Id,DataJson FROM PbeTrainingRecords WHERE OrganizationId='org' AND SeasonId='season' AND OwnerId='source' AND Kind='pbe-question-head' AND Id>'cursor' ORDER BY Id LIMIT 1000";
            await using var reader = await command.ExecuteReaderAsync(); var details = new List<string>(); while (await reader.ReadAsync()) details.Add(reader.GetString(3));
            Assert.Contains(details, d => d.Contains("SEARCH PbeTrainingRecords USING INDEX IX_PbeTrainingRecords_OrganizationId_SeasonId_OwnerId_Kind", StringComparison.Ordinal));
        }
        var movedId = Guid.NewGuid(); var at = Guid.NewGuid(); var bt = Guid.NewGuid();
        var moveOne = JsonSerializer.Deserialize<PbeQuestion>(JsonSerializer.Serialize(question), PbeQuestionBank.Json)!;
        moveOne.Id = movedId; moveOne.SourceUnitIds = [a.Id]; moveOne.Reference = a.CitationLabel; moveOne.Parts[0].TargetId = at;
        var moveTwo = JsonSerializer.Deserialize<PbeQuestion>(JsonSerializer.Serialize(moveOne, PbeQuestionBank.Json), PbeQuestionBank.Json)!;
        moveTwo.Version = 2; moveTwo.SourceUnitId = b.Id; moveTwo.SourceUnitIds = [b.Id]; moveTwo.Reference = b.CitationLabel; moveTwo.Evidence = b.CanonicalText; moveTwo.Parts[0].TargetId = bt;
        var moving = new { questions = new[] { moveOne, moveTwo }, targets = new[] { new PbeTarget { Id = at, SourceUnitIds = [a.Id], Skill = RecallSkill.FactualRecall, Label = "First" }, new PbeTarget { Id = bt, SourceUnitIds = [b.Id], Skill = RecallSkill.FactualRecall, Label = "Second" } } };
        (await coach.PostAsJsonAsync(path + "/questions/import", moving)).EnsureSuccessStatusCode();
        (await coach.PostAsJsonAsync(path + $"/questions/{movedId}/1/publish", new { })).EnsureSuccessStatusCode();
        (await coach.PostAsJsonAsync(path + $"/questions/{movedId}/2/publish", new { })).EnsureSuccessStatusCode();
        (await coach.PostAsJsonAsync(path + $"/questions/{movedId}/1/publish", new { })).EnsureSuccessStatusCode();
        var head = await db.PbeTrainingRecords.AsNoTracking().SingleAsync(r => r.Kind == "pbe-question-head" && r.Id == movedId.ToString());
        Assert.Equal(b.Id, head.OwnerId); Assert.Equal(2, JsonSerializer.Deserialize<PbeBankQuestionData>(head.DataJson, PbeQuestionBank.Json)!.Question.Version);
        var resolver = services.ServiceProvider.GetRequiredService<ICompetitionScopeResolver>();
        var study = services.ServiceProvider.GetRequiredService<IStudentStudyScopeService>();
        var userContext = new BankUser(me.GetProperty("userId").GetGuid(), org);
        var scopedBank = new PbeQuestionBank(db, userContext, resolver, study);
        Assert.DoesNotContain((await scopedBank.LoadAsync(new(org, season.Id, null, [a.Id]))).Questions, q => q.Id == movedId);
        var editing = new EditingResolver(resolver, async () => { await db.ScopeEntries.Where(s => s.SeasonId == season.Id).ExecuteDeleteAsync(); });
        var privateBank = new PbeQuestionBank(db, userContext, editing, study);
        await Assert.ThrowsAsync<PbeBankConflictException>(() => privateBank.LoadAsync(new(org, season.Id, null, [a.Id, b.Id])));
        season.Status = SeasonStatus.Archived; await db.SaveChangesAsync();
        Assert.Equal(HttpStatusCode.BadRequest, (await coach.GetAsync(path + "/bank")).StatusCode);
    }

    private sealed record BankUser(Guid UserId, Guid OrganizationId) : ICurrentUser
    {
        public bool IsAuthenticated => true;
        public UserKind Kind => UserKind.Adult;
        public OrganizationRole Role => OrganizationRole.Admin;
        public string DisplayName => "Coach";
        public bool IsAdmin => true;
        public bool IsStudent => false;
    }
    private sealed class EditingResolver(ICompetitionScopeResolver inner, Func<Task> edit) : ICompetitionScopeResolver
    {
        private int calls;
        public async Task<IReadOnlySet<Guid>> ResolveAsync(Guid organizationId, Guid seasonId, CancellationToken ct)
        {
            if (++calls == 2) await edit();
            return await inner.ResolveAsync(organizationId, seasonId, ct);
        }
    }
}
