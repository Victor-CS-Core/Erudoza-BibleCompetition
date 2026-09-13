using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Application.Study;
using Erudoza.Domain;
using Erudoza.Domain.Study;
using Erudoza.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
namespace Erudoza.IntegrationTests;

[Collection("Pbe chapter resource isolation")]
public sealed class PbeCooperationTests
{
    internal static async Task<JsonElement> FinishChapters(PbeStudyTests.Fixture f)
    {
        string? workId = null;
        for (var i = 0; i < 100; i++)
        {
            var response = await f.Student.PostAsJsonAsync("/api/v1/progress/me/chapters/continue", new { seasonId = f.Season, workId });
            Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
            var value = await response.Content.ReadFromJsonAsync<JsonElement>();
            if (value.GetProperty("next").GetString() == "Reload") return await f.Student.GetFromJsonAsync<JsonElement>($"/api/v1/progress/me/chapters?seasonId={f.Season}");
            workId = value.GetProperty("work").GetProperty("id").GetString();
        }
        throw new Exception("Chapter continuation exceeded fixture bound.");
    }
    internal static async Task<JsonElement> Finish(PbeStudyTests.Fixture f, HttpClient? caller = null, string? path = null)
    {
        caller ??= f.Student; path ??= "/api/v1/progress/me/pbe-cooperation";
        string? workId = null;
        for (var i = 0; i < 150; i++)
        {
            var response = await caller.PostAsJsonAsync(path + "/continue", new { seasonId = f.Season, workId });
            Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
            var value = await response.Content.ReadFromJsonAsync<JsonElement>();
            var work = value.GetProperty("work");
            if (work.GetProperty("next").GetString() == "Reload") return await caller.GetFromJsonAsync<JsonElement>(path + $"?seasonId={f.Season}");
            Assert.Equal("Continue", work.GetProperty("next").GetString());
            workId = work.GetProperty("id").GetString();
        }
        throw new Exception("Cooperation continuation exceeded fixture bound.");
    }
    [Fact]
    public async Task Missing_generation_preserves_assignment_unknown_counts_without_peer_work()
    {
        using var f = await PbeStudyTests.Fixture.Create();
        var response = await f.Student.GetAsync($"/api/v1/progress/me/pbe-cooperation?seasonId={f.Season}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("NotStarted", (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("state").GetString());
        Assert.False(await f.Db.PbeTrainingRecords.AnyAsync(r => r.Kind == "pbe-cooperation-work"));
        var snapshot = await Finish(f);
        Assert.Equal("Provisional", snapshot.GetProperty("state").GetString());
        Assert.Equal(1, snapshot.GetProperty("introduction").GetProperty("assigned").GetInt32());
        Assert.Equal(0, snapshot.GetProperty("introduction").GetProperty("retained").GetProperty("known").GetInt32());
        Assert.Equal(1, snapshot.GetProperty("introduction").GetProperty("retained").GetProperty("possible").GetInt32());
        Assert.Equal("Unknown", snapshot.GetProperty("own").GetProperty("state").GetString());
        Assert.DoesNotContain(f.StudentId.ToString(), snapshot.GetRawText());
        Assert.DoesNotContain(f.Unit.ToString(), snapshot.GetRawText());
        Assert.False(await f.Db.PbeTrainingRecords.AnyAsync(r => r.Kind == "pbe-chapter-work" || r.Kind == "pbe-chapter-stamp" || r.Kind == "pbe-evidence-replay"));
    }
    [Fact]
    public async Task Current_generation_is_known_and_later_pointer_availability_invalidates_snapshot()
    {
        using var f = await PbeStudyTests.Fixture.Create();
        await Finish(f); await FinishChapters(f);
        var stale = await f.Student.GetFromJsonAsync<JsonElement>($"/api/v1/progress/me/pbe-cooperation?seasonId={f.Season}");
        Assert.Equal("Updating", stale.GetProperty("state").GetString());
        Assert.Equal(JsonValueKind.Null, stale.GetProperty("introduction").ValueKind);
        var snapshot = await Finish(f);
        Assert.Equal("Snapshot", snapshot.GetProperty("state").GetString());
        Assert.Equal(1, snapshot.GetProperty("introduction").GetProperty("questionCovered").GetProperty("known").GetInt32());
        Assert.Equal(0, snapshot.GetProperty("introduction").GetProperty("retained").GetProperty("possible").GetInt32());
        Assert.Equal("Known", snapshot.GetProperty("own").GetProperty("state").GetString());
        var coachPath = $"/api/v1/organizations/{f.Org}/seasons/{f.Season}/pbe-cooperation";
        Assert.Equal(HttpStatusCode.Forbidden, (await f.Student.GetAsync(coachPath + "/students")).StatusCode);
        var detail = await f.Coach.GetAsync(coachPath + "/students");
        Assert.Equal(HttpStatusCode.OK, detail.StatusCode);
        Assert.Contains(f.StudentId.ToString(), await detail.Content.ReadAsStringAsync());
    }
    [Fact]
    public async Task Progress_selector_rejects_stale_intent_and_preserves_saved_start_payload()
    {
        using var f = await PbeStudyTests.Fixture.Create();
        var rejected = await f.Student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId = f.Season, format = "Pbe", progressScope = new { key = $"intro:{f.Intro}", scopeVersion = "stale" } });
        Assert.Equal(HttpStatusCode.Conflict, rejected.StatusCode);
        Assert.False(await f.Db.PbeTrainingRecords.AnyAsync(r => r.Kind == "pbe-session"));
        var chapters = await FinishChapters(f);
        var selector = chapters.GetProperty("items")[0].GetProperty("actions")[0].GetProperty("progressScope");
        var input = new { seasonId = f.Season, format = "Pbe", progressScope = selector, training = new { clientStartId = "chapter-start" } };
        var first = await f.Student.PostAsJsonAsync("/api/v1/study/sessions", input);
        Assert.True(first.IsSuccessStatusCode, await first.Content.ReadAsStringAsync());
        var before = await first.Content.ReadAsStringAsync();
        Assert.Equal(before, await (await f.Student.PostAsJsonAsync("/api/v1/study/sessions", input)).Content.ReadAsStringAsync());
        var changed = await f.Student.PostAsJsonAsync("/api/v1/study/sessions", new { input.seasonId, input.format, progressScope = new { key = "other", scopeVersion = selector.GetProperty("scopeVersion").GetString() }, input.training });
        Assert.Equal(HttpStatusCode.Conflict, changed.StatusCode);
        var row = await f.Db.PbeTrainingRecords.SingleAsync(r => r.Kind == "pbe-session");
        Assert.Contains("progressScope", JsonSerializer.Deserialize<PbeSessionSnapshot>(row.DataJson, PbeQuestionBank.Json)!.StartPayload);
        Assert.Equal(HttpStatusCode.BadRequest, (await f.Student.PostAsJsonAsync("/api/v1/study/sessions", new { input.seasonId, input.format, input.progressScope, targetIds = new[] { Guid.NewGuid() } })).StatusCode);
    }

    static async Task<Guid> AddMember(PbeStudyTests.Fixture f, bool assigned, UserKind kind = UserKind.Student, OrganizationRole role = OrganizationRole.Student)
    {
        var id = Guid.NewGuid();
        f.Db.Users.Add(new() { Id = id, UserName = "cooperation-" + id, DisplayName = "Private peer " + id, Kind = kind, IsActive = true, PasswordHash = "unused-test-only" });
        f.Db.OrganizationMembers.Add(new() { Id = Guid.NewGuid(), OrganizationId = f.Org, UserId = id, Role = role });
        f.Db.CompetitionMembers.Add(new() { Id = Guid.NewGuid(), OrganizationId = f.Org, SeasonId = f.Season, UserId = id });
        if (assigned) f.Db.PbeTrainingRecords.Add(new() { OrganizationId = f.Org, SeasonId = f.Season, OwnerId = id, Kind = "pbe-introduction-assignment", Id = $"{id}:{f.Season}:{f.Intro}", DataJson = JsonSerializer.Serialize(new { contentPackId = f.Intro }, PbeQuestionBank.Json) });
        await f.Db.SaveChangesAsync(); return id;
    }
    [Fact]
    public async Task Overlap_counts_union_once_unknown_members_keep_equal_weight_and_unassigned_roster()
    {
        using var f = await PbeStudyTests.Fixture.Create(); await FinishChapters(f);
        var peer = await AddMember(f, true); await AddMember(f, false); await AddMember(f, true, UserKind.Adult, OrganizationRole.Owner); await AddMember(f, true, UserKind.Student, OrganizationRole.Admin);
        var snapshot = await Finish(f); var intro = snapshot.GetProperty("introduction");
        Assert.Equal(3, snapshot.GetProperty("rosterStudents").GetInt32()); Assert.Equal(1, snapshot.GetProperty("unknownStudents").GetInt32());
        Assert.Equal(1, intro.GetProperty("assigned").GetInt32()); Assert.Equal(1, intro.GetProperty("questionCovered").GetProperty("known").GetInt32());
        var equal = intro.GetProperty("equalRetained"); Assert.Equal(2, equal.GetProperty("students").GetInt32()); Assert.Equal(1, equal.GetProperty("unassignedStudents").GetInt32()); Assert.Equal(.5, equal.GetProperty("upper").GetDouble());
        Assert.Equal(0, snapshot.GetProperty("own").GetProperty("introduction").GetProperty("retained").GetProperty("possible").GetInt32());
        Assert.DoesNotContain(peer.ToString(), snapshot.GetRawText());
        var path = $"/api/v1/organizations/{f.Org}/seasons/{f.Season}/pbe-cooperation/students";
        var first = await f.Coach.GetFromJsonAsync<JsonElement>(path + "?limit=1"); Assert.Single(first.GetProperty("items").EnumerateArray());
        var after = Uri.EscapeDataString(first.GetProperty("nextCursor").GetString()!); var second = await f.Coach.GetFromJsonAsync<JsonElement>(path + "?limit=1&after=" + after);
        Assert.NotEqual(first.GetProperty("items")[0].GetProperty("studentId").GetString(), second.GetProperty("items")[0].GetProperty("studentId").GetString());
        await AddMember(f, false); Assert.Equal(HttpStatusCode.Conflict, (await f.Coach.GetAsync(path + "?after=" + after)).StatusCode);
    }
    [Fact]
    public async Task Stale_complete_generation_is_unknown_and_later_evidence_changes_invalidate_even_unknown()
    {
        using var f = await PbeStudyTests.Fixture.Create(); await FinishChapters(f);
        var head = await f.Db.PbeTrainingRecords.FirstAsync(r => r.SeasonId == f.Season && r.Kind == "pbe-question-head"); head.Revision++; await f.Db.SaveChangesAsync();
        var snapshot = await Finish(f); Assert.Equal("Provisional", snapshot.GetProperty("state").GetString()); Assert.Equal(1, snapshot.GetProperty("introduction").GetProperty("assigned").GetInt32());
        head.Revision++; await f.Db.SaveChangesAsync(); var stale = await f.Student.GetFromJsonAsync<JsonElement>($"/api/v1/progress/me/pbe-cooperation?seasonId={f.Season}"); Assert.Equal("Updating", stale.GetProperty("state").GetString());
        var fresh = await Finish(f); Assert.Equal("Provisional", fresh.GetProperty("state").GetString()); Assert.NotEqual(snapshot.GetProperty("snapshotId").GetString(), fresh.GetProperty("snapshotId").GetString());
        Assert.Equal(1, await f.Db.PbeTrainingRecords.CountAsync(r => r.Kind == "pbe-chapter-work"));
    }
    [Fact]
    public async Task Publication_rejects_changed_assignment_and_bootstrap_recaptures_after_stale_response()
    {
        using var f = await PbeStudyTests.Fixture.Create(); string? workId = null;
        for (var i = 0; i < 100; i++)
        {
            var response = await f.Student.PostAsJsonAsync("/api/v1/progress/me/pbe-cooperation/continue", new { seasonId = f.Season, workId }); response.EnsureSuccessStatusCode(); var step = await response.Content.ReadFromJsonAsync<JsonElement>(); workId = step.GetProperty("work").GetProperty("id").GetString();
            var row = await f.Db.PbeTrainingRecords.AsNoTracking().SingleAsync(r => r.Kind == "pbe-cooperation-work"); if (JsonDocument.Parse(row.DataJson).RootElement.GetProperty("stage").GetString() == "Publishing") break;
        }
        await f.Db.PbeTrainingRecords.Where(r => r.SeasonId == f.Season && r.Kind == "pbe-introduction-assignment").ExecuteDeleteAsync();
        var stale = await f.Student.PostAsJsonAsync("/api/v1/progress/me/pbe-cooperation/continue", new { seasonId = f.Season, workId }); Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        Assert.False(await f.Db.PbeTrainingRecords.AnyAsync(r => r.Kind == "pbe-cooperation-snapshot"));
        var recaptured = await Finish(f); Assert.Equal(0, recaptured.GetProperty("introduction").GetProperty("assigned").GetInt32()); Assert.Equal(JsonValueKind.Null, recaptured.GetProperty("introduction").GetProperty("equalRetained").ValueKind);
        Assert.Equal("Unassigned", recaptured.GetProperty("own").GetProperty("state").GetString());
    }
    [Fact]
    public async Task Closed_and_disabled_scope_clear_claims_and_stop_continuation()
    {
        using var f = await PbeStudyTests.Fixture.Create(); await Finish(f);
        await f.Db.Seasons.Where(s => s.Id == f.Season).ExecuteUpdateAsync(s => s.SetProperty(x => x.PbeEnabled, false));
        var page = await f.Student.GetFromJsonAsync<JsonElement>($"/api/v1/progress/me/pbe-cooperation?seasonId={f.Season}"); Assert.Equal("Blocked", page.GetProperty("state").GetString()); Assert.Equal("PbeDisabled", page.GetProperty("reason").GetString()); Assert.Equal("None", page.GetProperty("work").GetProperty("next").GetString()); Assert.Equal(JsonValueKind.Null, page.GetProperty("own").ValueKind);
        await f.Db.Seasons.Where(s => s.Id == f.Season).ExecuteUpdateAsync(s => s.SetProperty(x => x.Status, SeasonStatus.Archived));
        page = await f.Student.GetFromJsonAsync<JsonElement>($"/api/v1/progress/me/pbe-cooperation?seasonId={f.Season}"); Assert.Equal("SeasonClosed", page.GetProperty("reason").GetString());
    }
    [Fact]
    public async Task Source_pages_bound_complete_ordinary_request_and_shared_bootstrap_survives_response_loss()
    {
        using var f = await PbeStudyTests.Fixture.Create();
        var intro = await f.Db.PbeTrainingRecords.SingleAsync(r => r.SeasonId == f.Season && r.Kind == "pbe-introduction"); var data = JsonSerializer.Deserialize<PbeIntroduction>(intro.DataJson, PbeQuestionBank.Json)!;
        data = data with { Units = Enumerable.Range(0, 150).Select(i => new PbeIntroductionUnit(Guid.NewGuid(), "Unicode λ " + i, new string('λ', 5000))).ToArray() }; intro.DataJson = JsonSerializer.Serialize(data, PbeQuestionBank.Json); intro.Revision++; await f.Db.SaveChangesAsync();
        using var meter = new PbeChapterResourceMeter(); f.Factory.CommandInterceptor = meter; var measurements = new List<object>(); string? workId = null;
        for (var i = 0; i < 100; i++)
        {
            var stored = await f.Db.PbeTrainingRecords.AsNoTracking().SingleOrDefaultAsync(r => r.Kind == "pbe-cooperation-work"); var final = stored is not null && JsonDocument.Parse(stored.DataJson).RootElement.GetProperty("stage").GetString() == "Publishing";
            meter.Reset(); meter.Active = true; var watch = System.Diagnostics.Stopwatch.StartNew();
            var response = await f.Student.PostAsJsonAsync("/api/v1/progress/me/pbe-cooperation/continue", new { seasonId = f.Season, workId }); watch.Stop(); meter.Active = false;
            measurements.Add(new { final, meter.Statements, meter.Rows, meter.ValueBytes, meter.MaxQueryValueBytes, meter.MaxBoundBytes, milliseconds = watch.ElapsedMilliseconds });
            Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync()); Assert.InRange(meter.Statements, 1, 50);
            if (!final) { Assert.InRange(meter.Rows, 0, 128); Assert.InRange(meter.ValueBytes, 0, 65536); }
            var step = await response.Content.ReadFromJsonAsync<JsonElement>(); if (step.GetProperty("work").GetProperty("next").GetString() == "Reload") break;
            workId = i == 0 ? null : step.GetProperty("work").GetProperty("id").GetString();
        }
        await File.WriteAllTextAsync(Path.Combine(AppContext.BaseDirectory, "d2-canonical-resource.json"), JsonSerializer.Serialize(measurements));
        var snapshot = await f.Student.GetFromJsonAsync<JsonElement>($"/api/v1/progress/me/pbe-cooperation?seasonId={f.Season}"); Assert.Equal(150, snapshot.GetProperty("introduction").GetProperty("assigned").GetInt32());
        Assert.Equal(1, await f.Db.PbeTrainingRecords.CountAsync(r => r.Kind == "pbe-cooperation-work"));
    }
    [Fact]
    public async Task Roster_cap_blocks_without_partial_counts()
    {
        using var f = await PbeStudyTests.Fixture.Create(); for (var i = 0; i < 32; i++) await AddMember(f, false);
        var response = await f.Student.PostAsJsonAsync("/api/v1/progress/me/pbe-cooperation/continue", new { seasonId = f.Season }); response.EnsureSuccessStatusCode(); var page = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("ScopeTooLarge", page.GetProperty("reason").GetString()); Assert.Equal(JsonValueKind.Null, page.GetProperty("introduction").ValueKind); Assert.False(await f.Db.PbeTrainingRecords.AnyAsync(r => r.Kind == "pbe-cooperation-snapshot"));
    }

    [Theory]
    [InlineData("roster")]
    [InlineData("assignment")]
    public async Task Publication_rechecks_admission_after_growth_before_input_capture(string growth)
    {
        using var f = await PbeStudyTests.Fixture.Create();
        var prior = await Finish(f); var publishedId = prior.GetProperty("snapshotId").GetString()!;
        var protectedRows = await f.Db.PbeTrainingRecords.AsNoTracking().Where(r => r.Kind == "pbe-cooperation-snapshot" || r.Kind == "pbe-cooperation-manifest" && r.Id.StartsWith(publishedId + ":")).ToDictionaryAsync(r => r.Kind + ":" + r.Id, r => new { r.DataJson, r.Revision });
        const string path = "/api/v1/progress/me/pbe-cooperation/continue";
        var started = await f.Student.PostAsJsonAsync(path, new { seasonId = f.Season }); started.EnsureSuccessStatusCode();
        var workId = (await started.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("work").GetProperty("id").GetString()!;
        Assert.NotEqual(publishedId, workId);
        var admitted = JsonDocument.Parse((await f.Db.PbeTrainingRecords.AsNoTracking().SingleAsync(r => r.Kind == "pbe-cooperation-work")).DataJson).RootElement;
        Assert.Equal("Sources", admitted.GetProperty("stage").GetString());
        Assert.False(await f.Db.PbeTrainingRecords.AnyAsync(r => r.Kind == "pbe-cooperation-manifest" && r.Id.StartsWith(workId + ":")));
        // The original early check admitted one student and one assignment. Grow before any inputs are captured.
        if (growth == "roster")
        {
            for (var i = 0; i < 32; i++) await AddMember(f, false);
            Assert.Equal(33, await f.Db.CompetitionMembers.CountAsync(r => r.OrganizationId == f.Org && r.SeasonId == f.Season));
        }
        else
        {
            var body = JsonSerializer.Serialize(new { contentPackId = f.Intro }, PbeQuestionBank.Json);
            f.Db.PbeTrainingRecords.AddRange(Enumerable.Range(0, 10000).Select(n => new PbeTrainingRecord { OrganizationId = f.Org, SeasonId = f.Season, OwnerId = f.StudentId, Kind = "pbe-introduction-assignment", Id = "late-assignment-" + n, DataJson = body })); await f.Db.SaveChangesAsync();
            Assert.Equal(10001, await f.Db.PbeTrainingRecords.CountAsync(r => r.OrganizationId == f.Org && r.SeasonId == f.Season && r.Kind == "pbe-introduction-assignment"));
        }
        using var meter = new PbeChapterResourceMeter(); f.Factory.CommandInterceptor = meter;
        var measurements = new List<object>(); JsonElement terminal = default; var reachedPublication = false;
        for (var i = 0; i < 150; i++)
        {
            var stored = await f.Db.PbeTrainingRecords.AsNoTracking().SingleAsync(r => r.Kind == "pbe-cooperation-work");
            var final = JsonDocument.Parse(stored.DataJson).RootElement.GetProperty("stage").GetString() == "Publishing";
            meter.Reset(); meter.Active = true;
            var response = await f.Student.PostAsJsonAsync(path, new { seasonId = f.Season, workId }); meter.Active = false;
            Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync()); Assert.InRange(meter.Statements, 1, 50);
            if (!final) { Assert.InRange(meter.Rows, 0, 128); Assert.InRange(meter.ValueBytes, 0, 65536); }
            measurements.Add(new { final, meter.Statements, meter.Rows, meter.ValueBytes, meter.MaxQueryValueBytes, meter.MaxBoundBytes });
            var step = await response.Content.ReadFromJsonAsync<JsonElement>();
            if (final) { terminal = step; reachedPublication = true; break; }
            Assert.Equal("Continue", step.GetProperty("work").GetProperty("next").GetString());
        }
        await File.WriteAllTextAsync(Path.Combine(AppContext.BaseDirectory, $"d2-fix1-canonical-{growth}-resource.json"), JsonSerializer.Serialize(measurements));
        Assert.True(reachedPublication, "The consistent grown inputs must reach actual publication within the existing continuation bound.");
        Assert.Equal("Blocked", terminal.GetProperty("state").GetString());
        Assert.Equal("ScopeTooLarge", terminal.GetProperty("reason").GetString());
        Assert.Equal("None", terminal.GetProperty("work").GetProperty("next").GetString());
        Assert.Equal(JsonValueKind.Null, terminal.GetProperty("scripture").ValueKind); Assert.Equal(JsonValueKind.Null, terminal.GetProperty("introduction").ValueKind);
        Assert.False(await f.Db.PbeTrainingRecords.AnyAsync(r => r.Kind == "pbe-cooperation-snapshot" && r.Id == workId));
        Assert.False(await f.Db.PbeTrainingRecords.AnyAsync(r => r.Kind == "pbe-cooperation-manifest" && r.Id.StartsWith(workId + ":subjects:")));
        var blocked = JsonDocument.Parse((await f.Db.PbeTrainingRecords.AsNoTracking().SingleAsync(r => r.Kind == "pbe-cooperation-work")).DataJson).RootElement;
        Assert.Equal("Blocked", blocked.GetProperty("stage").GetString()); Assert.Equal(publishedId, blocked.GetProperty("publishedId").GetString());
        foreach (var row in await f.Db.PbeTrainingRecords.AsNoTracking().Where(r => r.Kind == "pbe-cooperation-snapshot" || r.Kind == "pbe-cooperation-manifest" && r.Id.StartsWith(publishedId + ":")).ToListAsync())
        { Assert.True(protectedRows.Remove(row.Kind + ":" + row.Id, out var expected)); Assert.Equal((expected!.DataJson, expected.Revision), (row.DataJson, row.Revision)); }
        Assert.Empty(protectedRows);
    }

    [Fact]
    public void Portable_codec_preserves_supplementary_unicode_and_control_escapes()
    {
        var encoded = PbeCooperationService.Serialize(new object[] { "pbe-cooperation-v1", "é \"quote\" \\ line\n\u0001 🧭", new[] { "Commentary", "Ω", "引用" } });
        Assert.Equal(87, System.Text.Encoding.UTF8.GetByteCount(encoded)); Assert.Equal("9d9014690e262fe471adbf8b174de7ac5c1c6752d94e404a76d67243b05c4952", PbeCooperationService.Hash(encoded));
    }

    [Fact]
    public async Task Valid_D1_Unicode_metadata_is_compared_semantically_without_changing_legacy_codec()
    {
        using var f = await PbeStudyTests.Fixture.Create(); var row = await f.Db.PbeTrainingRecords.SingleAsync(r => r.SeasonId == f.Season && r.Kind == "pbe-introduction");
        var intro = JsonSerializer.Deserialize<PbeIntroduction>(row.DataJson, PbeQuestionBank.Json)!;
        row.DataJson = JsonSerializer.Serialize(intro with { Units = intro.Units.Select(u => u with { Citation = "Path / 🧭 / λ" }).ToArray() }, PbeQuestionBank.Json); row.Revision++; await f.Db.SaveChangesAsync();
        await FinishChapters(f); var page = await Finish(f); Assert.Equal("Snapshot", page.GetProperty("state").GetString());
    }
    [Fact]
    public async Task Corrupted_fact_page_is_rejected_before_publishing_claims()
    {
        using var f = await PbeStudyTests.Fixture.Create(); string? workId = null;
        for (var i = 0; i < 100; i++)
        {
            var response = await f.Student.PostAsJsonAsync("/api/v1/progress/me/pbe-cooperation/continue", new { seasonId = f.Season, workId }); response.EnsureSuccessStatusCode(); var step = await response.Content.ReadFromJsonAsync<JsonElement>(); workId = step.GetProperty("work").GetProperty("id").GetString();
            var row = await f.Db.PbeTrainingRecords.AsNoTracking().SingleAsync(r => r.Kind == "pbe-cooperation-work"); if (JsonDocument.Parse(row.DataJson).RootElement.GetProperty("stage").GetString() == "Publishing") break;
        }
        var fact = await f.Db.PbeTrainingRecords.SingleAsync(r => r.Kind == "pbe-cooperation-manifest" && r.Id.Contains(":facts:")); var payload = System.Text.Json.Nodes.JsonNode.Parse(fact.DataJson)!; payload["entries"]![0]!["retained"] = true; fact.DataJson = payload.ToJsonString(); await f.Db.SaveChangesAsync();
        Assert.Equal(HttpStatusCode.Conflict, (await f.Student.PostAsJsonAsync("/api/v1/progress/me/pbe-cooperation/continue", new { seasonId = f.Season, workId })).StatusCode);
        Assert.False(await f.Db.PbeTrainingRecords.AnyAsync(r => r.Kind == "pbe-cooperation-snapshot"));
    }
    [Theory]
    [InlineData("bytes", 33554400)]
    [InlineData("guardBytes", 16777184)]
    public async Task Staging_caps_reject_before_page_insertion(string field, int bytes)
    {
        using var f = await PbeStudyTests.Fixture.Create(); var response = await f.Student.PostAsJsonAsync("/api/v1/progress/me/pbe-cooperation/continue", new { seasonId = f.Season }); response.EnsureSuccessStatusCode();
        var row = await f.Db.PbeTrainingRecords.SingleAsync(r => r.Kind == "pbe-cooperation-work"); var payload = System.Text.Json.Nodes.JsonNode.Parse(row.DataJson)!; payload[field] = bytes; row.DataJson = payload.ToJsonString(); await f.Db.SaveChangesAsync();
        response = await f.Student.PostAsJsonAsync("/api/v1/progress/me/pbe-cooperation/continue", new { seasonId = f.Season, workId = payload["workId"]!.GetValue<string>() }); response.EnsureSuccessStatusCode();
        Assert.Equal("InputTooLarge", (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("reason").GetString()); Assert.False(await f.Db.PbeTrainingRecords.AnyAsync(r => r.Kind == "pbe-cooperation-manifest"));
    }
    [Fact]
    public async Task Original_Solo_retention_counts_sources_once_and_due_can_overlap_retained()
    {
        using var f = await PbeStudyTests.Fixture.Create(); var heads = (await f.Db.PbeTrainingRecords.AsNoTracking().Where(r => r.SeasonId == f.Season && r.Kind == "pbe-question-head").OrderBy(r => r.Id).ToListAsync()).Select(r => JsonSerializer.Deserialize<PbeBankQuestionData>(r.DataJson, PbeQuestionBank.Json)!.Question).ToArray(); var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        for (var i = 0; i < 2; i++)
        {
            using var scope = f.Factory.Services.CreateScope(); var progress = scope.ServiceProvider.GetRequiredService<PbeProgressService>(); var q = heads[i]; var at = now - (6 - i * 2) * 86400000L; var attemptId = Guid.NewGuid();
            await progress.ExecuteAsync(ct => progress.PrepareRecallEvidenceAsync(f.Org, f.Season, f.StudentId, "frozen", q.Parts.Select(p => new PbeRecallEvidence(attemptId, p.TargetId, q.Id, at, p.Points, p.Points, true, true)).ToArray(), ct, q.Kind.ToString(), q.Version, at));
        }
        await FinishChapters(f); var snapshot = await Finish(f); var intro = snapshot.GetProperty("introduction"); Assert.Equal("Snapshot", snapshot.GetProperty("state").GetString()); Assert.Equal(1, intro.GetProperty("retained").GetProperty("known").GetInt32()); Assert.Equal(1, intro.GetProperty("due").GetProperty("known").GetInt32()); Assert.Equal(1, intro.GetProperty("practiced").GetProperty("known").GetInt32());
        Assert.Equal(1, await f.Db.PbeTrainingRecords.CountAsync(r => r.Kind == "pbe-chapter-stamp"));
    }
    [Theory]
    [InlineData("Assignments")]
    [InlineData("Publishing")]
    public async Task Source_changes_after_capture_never_publish_a_different_interpretation(string changeStage)
    {
        using var f = await PbeStudyTests.Fixture.Create(); await FinishChapters(f); string? workId = null;
        for (var i = 0; i < 100; i++)
        {
            var response = await f.Student.PostAsJsonAsync("/api/v1/progress/me/pbe-cooperation/continue", new { seasonId = f.Season, workId }); response.EnsureSuccessStatusCode();
            workId = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("work").GetProperty("id").GetString();
            var work = await f.Db.PbeTrainingRecords.AsNoTracking().SingleAsync(r => r.Kind == "pbe-cooperation-work"); if (JsonDocument.Parse(work.DataJson).RootElement.GetProperty("stage").GetString() == changeStage) break;
        }
        var row = await f.Db.PbeTrainingRecords.SingleAsync(r => r.SeasonId == f.Season && r.Kind == "pbe-introduction"); var intro = JsonSerializer.Deserialize<PbeIntroduction>(row.DataJson, PbeQuestionBank.Json)!;
        row.DataJson = JsonSerializer.Serialize(intro with { Units = intro.Units.Select(u => u with { CanonicalText = u.CanonicalText + " changed" }).ToArray() }, PbeQuestionBank.Json); await f.Db.SaveChangesAsync();
        for (var i = 0; i < 100; i++)
        {
            var response = await f.Student.PostAsJsonAsync("/api/v1/progress/me/pbe-cooperation/continue", new { seasonId = f.Season, workId });
            if (response.StatusCode == HttpStatusCode.Conflict) break;
            response.EnsureSuccessStatusCode(); Assert.NotEqual("Reload", (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("work").GetProperty("next").GetString());
            Assert.True(i < 99, "Changed source was not rejected.");
        }
        Assert.False(await f.Db.PbeTrainingRecords.AnyAsync(r => r.Kind == "pbe-cooperation-snapshot"));
        var recaptured = await Finish(f); Assert.Equal("Provisional", recaptured.GetProperty("state").GetString());
    }
    [Fact]
    public async Task Removed_whole_page_clears_published_counts()
    {
        using var f = await PbeStudyTests.Fixture.Create(); await Finish(f);
        await f.Db.PbeTrainingRecords.Where(r => r.Kind == "pbe-cooperation-manifest" && r.Id.Contains(":facts:")).ExecuteDeleteAsync();
        var snapshot = await f.Student.GetFromJsonAsync<JsonElement>($"/api/v1/progress/me/pbe-cooperation?seasonId={f.Season}"); Assert.Equal("Updating", snapshot.GetProperty("state").GetString()); Assert.Equal(JsonValueKind.Null, snapshot.GetProperty("introduction").ValueKind);
    }

    [Theory]
    [InlineData(10001, 1)]
    [InlineData(8334, 6)]
    public async Task Union_and_student_source_pair_caps_block_before_materializing_sources(int units, int students)
    {
        using var f = await PbeStudyTests.Fixture.Create(); for (var n = 1; n < students; n++) await AddMember(f, true);
        var row = await f.Db.PbeTrainingRecords.SingleAsync(r => r.SeasonId == f.Season && r.Kind == "pbe-introduction"); var intro = JsonSerializer.Deserialize<PbeIntroduction>(row.DataJson, PbeQuestionBank.Json)!;
        row.DataJson = JsonSerializer.Serialize(intro with { Units = Enumerable.Range(0, units).Select(n => new PbeIntroductionUnit(Guid.NewGuid(), "Unit " + n, "text")).ToArray() }, PbeQuestionBank.Json); await f.Db.SaveChangesAsync();
        using var meter = new PbeChapterResourceMeter(); f.Factory.CommandInterceptor = meter; meter.Active = true;
        var response = await f.Student.PostAsJsonAsync("/api/v1/progress/me/pbe-cooperation/continue", new { seasonId = f.Season }); meter.Active = false; response.EnsureSuccessStatusCode();
        Assert.Equal("ScopeTooLarge", (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("reason").GetString()); Assert.InRange(meter.Rows, 0, 128); Assert.InRange(meter.ValueBytes, 0, 65536); Assert.InRange(meter.Statements, 1, 50);
        Assert.False(await f.Db.PbeTrainingRecords.AnyAsync(r => r.Kind == "pbe-cooperation-manifest"));
    }
    [Fact]
    public async Task Assignment_family_cap_blocks_before_staging()
    {
        using var f = await PbeStudyTests.Fixture.Create(); var body = JsonSerializer.Serialize(new { contentPackId = f.Intro }, PbeQuestionBank.Json);
        f.Db.PbeTrainingRecords.AddRange(Enumerable.Range(0, 10000).Select(n => new PbeTrainingRecord { OrganizationId = f.Org, SeasonId = f.Season, OwnerId = f.StudentId, Kind = "pbe-introduction-assignment", Id = "repeated-" + n, DataJson = body })); await f.Db.SaveChangesAsync();
        var response = await f.Student.PostAsJsonAsync("/api/v1/progress/me/pbe-cooperation/continue", new { seasonId = f.Season }); response.EnsureSuccessStatusCode(); Assert.Equal("ScopeTooLarge", (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("reason").GetString()); Assert.False(await f.Db.PbeTrainingRecords.AnyAsync(r => r.Kind == "pbe-cooperation-manifest"));
    }
    [Fact]
    public async Task Completed_retry_is_bounded_current_get_is_authoritative_and_bootstrap_replaces()
    {
        using var f = await PbeStudyTests.Fixture.Create();
        var starts = await Task.WhenAll(Enumerable.Range(0, 2).Select(_ => f.Student.PostAsJsonAsync("/api/v1/progress/me/pbe-cooperation/continue", new { seasonId = f.Season }))); var ids = new List<string?>(); foreach (var start in starts) { Assert.True(start.IsSuccessStatusCode, await start.Content.ReadAsStringAsync()); ids.Add((await start.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("work").GetProperty("id").GetString()); }
        Assert.Single(ids.Distinct());
        var before = await Finish(f); var workId = before.GetProperty("snapshotId").GetString(); await AddMember(f, true);
        using var meter = new PbeChapterResourceMeter(); f.Factory.CommandInterceptor = meter; meter.Active = true;
        var response = await f.Student.PostAsJsonAsync("/api/v1/progress/me/pbe-cooperation/continue", new { seasonId = f.Season, workId }); meter.Active = false; response.EnsureSuccessStatusCode(); Assert.Equal("Reload", (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("work").GetProperty("next").GetString()); Assert.InRange(meter.Rows, 0, 128); Assert.InRange(meter.ValueBytes, 0, 65536);
        Assert.Equal("Updating", (await f.Student.GetFromJsonAsync<JsonElement>($"/api/v1/progress/me/pbe-cooperation?seasonId={f.Season}")).GetProperty("state").GetString()); Assert.NotEqual(workId, (await Finish(f)).GetProperty("snapshotId").GetString());
    }
    [Fact]
    public async Task Missing_D1_metadata_at_capture_is_unknown_without_peer_replay()
    {
        using var f = await PbeStudyTests.Fixture.Create(); await FinishChapters(f); var row = await f.Db.PbeTrainingRecords.FirstAsync(r => r.Kind == "pbe-chapter-manifest" && r.Id.Contains(":inputs:")); f.Db.PbeTrainingRecords.Remove(row); await f.Db.SaveChangesAsync();
        Assert.Equal("Provisional", (await Finish(f)).GetProperty("state").GetString()); Assert.False(await f.Db.PbeTrainingRecords.AnyAsync(r => r.Kind == "pbe-chapter-stamp"));
    }
    [Fact]
    public async Task Legacy_start_bytes_and_receipt_survive_unrelated_bank_revision()
    {
        using var f = await PbeStudyTests.Fixture.Create(); var input = new { seasonId = f.Season, format = "Pbe", training = new { clientStartId = "legacy-d2" } };
        var first = await f.Student.PostAsJsonAsync("/api/v1/study/sessions", input); first.EnsureSuccessStatusCode(); var receipt = await first.Content.ReadAsStringAsync();
        var stored = JsonSerializer.Deserialize<PbeSessionSnapshot>((await f.Db.PbeTrainingRecords.SingleAsync(r => r.Kind == "pbe-session")).DataJson, PbeQuestionBank.Json)!; Assert.DoesNotContain("progressScope", stored.StartPayload);
        var head = await f.Db.PbeTrainingRecords.FirstAsync(r => r.Kind == "pbe-question-head"); head.Revision++; await f.Db.SaveChangesAsync(); Assert.Equal(receipt, await (await f.Student.PostAsJsonAsync("/api/v1/study/sessions", input)).Content.ReadAsStringAsync());
    }
    [Fact]
    public async Task Fresh_membership_and_tenant_authorization_guard_shared_work()
    {
        using var f = await PbeStudyTests.Fixture.Create(); var path = $"/api/v1/organizations/{Guid.NewGuid()}/seasons/{f.Season}/pbe-cooperation"; Assert.Equal(HttpStatusCode.Forbidden, (await f.Coach.GetAsync(path)).StatusCode);
        await f.Db.CompetitionMembers.Where(m => m.UserId == f.StudentId && m.SeasonId == f.Season).ExecuteDeleteAsync(); Assert.Equal(HttpStatusCode.Forbidden, (await f.Student.GetAsync($"/api/v1/progress/me/pbe-cooperation?seasonId={f.Season}")).StatusCode); Assert.Equal(HttpStatusCode.Forbidden, (await f.Student.PostAsJsonAsync("/api/v1/progress/me/pbe-cooperation/continue", new { seasonId = f.Season })).StatusCode); Assert.False(await f.Db.PbeTrainingRecords.AnyAsync(r => r.Kind == "pbe-cooperation-work"));
    }

    [Fact]
    public async Task Chapter_start_keeps_fully_assigned_spanning_questions_and_exclusions_remove_them()
    {
        using var f = await PbeStudyTests.Fixture.Create(); var pack = new ContentPack { Id = Guid.NewGuid(), OrganizationId = f.Org, PackKey = "cooperation-spanning", LicensingStatus = "approved" }; var document = new SourceDocument { Id = Guid.NewGuid(), ContentPackId = pack.Id, Name = "Spanning" };
        var units = Enumerable.Range(1, 2).Select(n => new SourceUnit { Id = Guid.NewGuid(), ContentPackId = pack.Id, SourceDocumentId = document.Id, OrganizationId = f.Org, BookKey = "GEN", Chapter = n, Verse = 1, Ordinal = n, CitationLabel = $"Genesis {n}:1", CanonicalText = "Alpha" }).ToArray();
        f.Db.ContentPacks.Add(pack); f.Db.SourceDocuments.Add(document); f.Db.SourceUnits.AddRange(units); f.Db.ScopeEntries.Add(new() { Id = Guid.NewGuid(), OrganizationId = f.Org, SeasonId = f.Season, ContentPackId = pack.Id, Kind = ScopeEntryKind.Include, BookKey = "GEN", StartChapter = 1, EndChapter = 2, StartVerse = 1, EndVerse = 1 }); f.Db.Assignments.Add(new() { Id = Guid.NewGuid(), OrganizationId = f.Org, SeasonId = f.Season, StudentUserId = f.StudentId, Type = AssignmentType.RequiredCoverage, Scopes = [new() { Id = Guid.NewGuid(), ContentPackId = pack.Id, BookKey = "GEN", StartChapter = 1, EndChapter = 2, StartVerse = 1, EndVerse = 1 }] }); await f.Db.SaveChangesAsync();
        var target = Guid.NewGuid(); var question = Guid.NewGuid(); var path = $"/api/v1/organizations/{f.Org}/practice/pbe/seasons/{f.Season}";
        var imported = await f.Coach.PostAsJsonAsync(path + "/questions/import", new { targets = new[] { new { id = target, sourceUnitIds = units.Select(u => u.Id), skill = "FactualRecall", label = "Spanning" } }, questions = new[] { new { schemaVersion = 2, id = question, version = 1, contentPackId = pack.Id, sourceUnitId = units[0].Id, sourceUnitIds = units.Select(u => u.Id), sourceKind = "Scripture", reference = "Genesis 1:1; Genesis 2:1", evidence = "Alpha", kind = "ShortAnswer", prompt = "Name it.", ordered = false, parts = new[] { new { targetId = target, acceptedAnswers = new[] { "Alpha" }, points = 1 } } } } }); Assert.True(imported.IsSuccessStatusCode, await imported.Content.ReadAsStringAsync()); (await f.Coach.PostAsJsonAsync(path + $"/questions/{question}/1/publish", new { })).EnsureSuccessStatusCode();
        var chapters = await FinishChapters(f); var chapter = chapters.GetProperty("items").EnumerateArray().Single(x => x.GetProperty("key").GetString() == $"chapter:{pack.Id}:GEN:2"); var selector = chapter.GetProperty("actions")[0].GetProperty("progressScope");
        var started = await f.Student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId = f.Season, format = "Pbe", progressScope = selector }); Assert.True(started.IsSuccessStatusCode, await started.Content.ReadAsStringAsync()); var saved = JsonSerializer.Deserialize<PbeSessionSnapshot>((await f.Db.PbeTrainingRecords.SingleAsync(r => r.Kind == "pbe-session")).DataJson, PbeQuestionBank.Json)!; Assert.Contains(question.ToString(), JsonSerializer.Serialize(saved, PbeQuestionBank.Json));
        var initial = await Finish(f); Assert.Equal(2, initial.GetProperty("scripture").GetProperty("assigned").GetInt32()); Assert.Equal(2, initial.GetProperty("scripture").GetProperty("questionCovered").GetProperty("known").GetInt32());
        f.Db.ScopeEntries.Add(new() { Id = Guid.NewGuid(), OrganizationId = f.Org, SeasonId = f.Season, ContentPackId = pack.Id, Kind = ScopeEntryKind.Exclude, BookKey = "GEN", StartChapter = 2, EndChapter = 2, StartVerse = 1, EndVerse = 1 }); await f.Db.SaveChangesAsync(); await FinishChapters(f); var narrowed = await Finish(f); Assert.Equal(1, narrowed.GetProperty("scripture").GetProperty("assigned").GetInt32()); Assert.Equal(0, narrowed.GetProperty("scripture").GetProperty("questionCovered").GetProperty("known").GetInt32());
    }

    [Fact]
    public async Task First_answer_after_chapter_and_cooperation_progress_accepts_once_with_exact_retries()
    {
        using var f = await PbeStudyTests.Fixture.Create();
        var chapters = await FinishChapters(f); await Finish(f);
        var index = await f.Db.PbeTrainingRecords.AsNoTracking().SingleAsync(r => r.SeasonId == f.Season && r.OwnerId == f.StudentId && r.Kind == "pbe-evidence-index");
        Assert.True(JsonSerializer.Deserialize<PbeEvidenceIndex>(index.DataJson, PbeProgressService.Json)!.Ready);
        Assert.False(await f.Db.PbeTrainingRecords.AnyAsync(r => r.SeasonId == f.Season && r.OwnerId == f.StudentId && r.Kind == "pbe-recall-sequence"));
        var selector = chapters.GetProperty("items")[0].GetProperty("actions")[0].GetProperty("progressScope");
        var start = new { seasonId = f.Season, format = "Pbe", progressScope = selector, training = new { clientStartId = "first-answer-after-progress" } };
        var response = await f.Student.PostAsJsonAsync("/api/v1/study/sessions", start); response.EnsureSuccessStatusCode();
        var receipt = await response.Content.ReadAsStringAsync(); var sessionId = JsonDocument.Parse(receipt).RootElement.GetProperty("id").GetGuid();
        Assert.Equal(receipt, await (await f.Student.PostAsJsonAsync("/api/v1/study/sessions", start)).Content.ReadAsStringAsync());
        var path = $"/api/v1/study/sessions/{sessionId}";
        var cards = await Task.WhenAll(Enumerable.Range(0, 2).Select(_ => f.Student.GetFromJsonAsync<JsonElement>(path + "/next")));
        Assert.Equal(cards[0].GetProperty("id").GetGuid(), cards[1].GetProperty("id").GetGuid());
        var input = new { clientSubmissionId = "first-answer", challengeCardId = cards[0].GetProperty("id").GetGuid(), answers = new[] { "wrong", "wrong" }, hintsUsed = false };
        var accepted = await f.Student.PostAsJsonAsync(path + "/attempts", input);
        Assert.True(accepted.IsSuccessStatusCode, await accepted.Content.ReadAsStringAsync());
        var answer = await accepted.Content.ReadFromJsonAsync<JsonElement>();
        var retry = await f.Student.PostAsJsonAsync(path + "/attempts", input); retry.EnsureSuccessStatusCode(); var replay = await retry.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(answer.GetProperty("attemptId").GetGuid(), replay.GetProperty("attemptId").GetGuid());
        Assert.Equal(answer.GetProperty("acceptedAtUtc").GetString(), replay.GetProperty("acceptedAtUtc").GetString()); Assert.True(replay.GetProperty("alreadyProcessed").GetBoolean());
        Assert.Equal(HttpStatusCode.Conflict, (await f.Student.PostAsJsonAsync(path + "/attempts", new { input.clientSubmissionId, input.challengeCardId, answers = new[] { "Alpha", "Beta" }, input.hintsUsed })).StatusCode);
        var afterIndex = await f.Db.PbeTrainingRecords.AsNoTracking().SingleAsync(r => r.SeasonId == f.Season && r.OwnerId == f.StudentId && r.Kind == "pbe-evidence-index");
        Assert.Equal((index.DataJson, index.Revision), (afterIndex.DataJson, afterIndex.Revision));
        var saved = JsonSerializer.Deserialize<PbeSessionSnapshot>((await f.Db.PbeTrainingRecords.AsNoTracking().SingleAsync(r => r.Kind == "pbe-session" && r.Id == sessionId.ToString())).DataJson, PbeQuestionBank.Json)!;
        Assert.Single(saved.Attempts); Assert.Equal(1, await f.Db.PbeTrainingRecords.CountAsync(r => r.SeasonId == f.Season && r.OwnerId == f.StudentId && r.Kind == "pbe-recall-event"));
    }

    [Fact]
    public async Task Completed_generation_cleanup_returns_resumable_null_id_and_preserves_current_pages()
    {
        using var f = await PbeStudyTests.Fixture.Create(); await FinishChapters(f);
        var first = await Finish(f); var abandonedId = first.GetProperty("snapshotId").GetString()!;
        var head = await f.Db.PbeTrainingRecords.FirstAsync(r => r.SeasonId == f.Season && r.Kind == "pbe-question-head"); head.Revision++; await f.Db.SaveChangesAsync();
        var second = await Finish(f); var completedId = second.GetProperty("snapshotId").GetString()!;
        var oldPages = await f.Db.PbeTrainingRecords.AsNoTracking().Where(r => r.Kind == "pbe-cooperation-manifest" && r.Id.StartsWith(abandonedId + ":")).ToListAsync();
        // Valid empty abandoned fact pages exercise more than one112-ID cleanup chunk.
        for (var ordinal = oldPages.Count; ordinal < 130; ordinal++)
        {
            var id = $"{abandonedId}:facts:{ordinal:D6}"; var entries = Array.Empty<CooperationFact>();
            var page = new PbeCooperationService.Page<CooperationFact>(id, abandonedId, "facts", ordinal, entries, 0, PbeCooperationService.Hash(PbeCooperationService.Serialize(entries)));
            while (true) { var bytes = System.Text.Encoding.UTF8.GetByteCount(PbeCooperationService.Serialize(page)); if (bytes == page.Bytes) break; page = page with { Bytes = bytes }; }
            f.Db.PbeTrainingRecords.Add(new() { OrganizationId = f.Org, SeasonId = f.Season, Kind = "pbe-cooperation-manifest", Id = id, DataJson = PbeCooperationService.Serialize(page) });
        }
        head.Revision++; await f.Db.SaveChangesAsync();
        var protectedRows = await f.Db.PbeTrainingRecords.AsNoTracking().Where(r => r.SeasonId == f.Season && (r.Kind.StartsWith("pbe-chapter-") || r.Id.StartsWith(completedId))).ToDictionaryAsync(r => r.Kind + ":" + r.Id, r => new { r.DataJson, r.Revision });
        var workBeforeGet = await f.Db.PbeTrainingRecords.AsNoTracking().SingleAsync(r => r.Kind == "pbe-cooperation-work" && r.SeasonId == f.Season);
        var pageBefore = await f.Student.GetFromJsonAsync<JsonElement>($"/api/v1/progress/me/pbe-cooperation?seasonId={f.Season}"); Assert.Equal("Updating", pageBefore.GetProperty("state").GetString());
        var workAfterGet = await f.Db.PbeTrainingRecords.AsNoTracking().SingleAsync(r => r.Kind == "pbe-cooperation-work" && r.SeasonId == f.Season); Assert.Equal((workBeforeGet.DataJson, workBeforeGet.Revision), (workAfterGet.DataJson, workAfterGet.Revision));
        Assert.Equal(130, await f.Db.PbeTrainingRecords.CountAsync(r => r.Kind == "pbe-cooperation-manifest" && r.Id.StartsWith(abandonedId + ":")));
        using var meter = new PbeChapterResourceMeter(); f.Factory.CommandInterceptor = meter;
        var metrics = new List<object>(); string? workId = null; var pendingCleanup = 0; string? freshId = null;
        for (var i = 0; i < 100; i++)
        {
            var stored = await f.Db.PbeTrainingRecords.AsNoTracking().SingleAsync(r => r.Kind == "pbe-cooperation-work" && r.SeasonId == f.Season); var final = JsonDocument.Parse(stored.DataJson).RootElement.GetProperty("stage").GetString() == "Publishing";
            meter.Reset(); meter.Active = true; var response = await f.Student.PostAsJsonAsync("/api/v1/progress/me/pbe-cooperation/continue", new { seasonId = f.Season, workId }); meter.Active = false;
            Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync()); Assert.InRange(meter.Statements, 1, 50); if (!final) { Assert.InRange(meter.Rows, 0, 128); Assert.InRange(meter.ValueBytes, 0, 65536); }
            metrics.Add(new { final, meter.Statements, meter.Rows, meter.ValueBytes });
            var step = await response.Content.ReadFromJsonAsync<JsonElement>(); var next = step.GetProperty("work"); workId = next.GetProperty("id").GetString();
            if (i < 2)
            {
                Assert.Equal("Continue", next.GetProperty("next").GetString()); Assert.Null(workId); pendingCleanup++;
                Assert.Equal(i == 0 ? 18 : 0, await f.Db.PbeTrainingRecords.CountAsync(r => r.Kind == "pbe-cooperation-manifest" && r.Id.StartsWith(abandonedId + ":")));
                var receipt = await f.Student.PostAsJsonAsync("/api/v1/progress/me/pbe-cooperation/continue", new { seasonId = f.Season, workId = completedId }); receipt.EnsureSuccessStatusCode();
                Assert.Equal("Reload", (await receipt.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("work").GetProperty("next").GetString());
            }
            else { Assert.NotEqual(completedId, workId); freshId = workId; }
            if (next.GetProperty("next").GetString() == "Reload") break;
            Assert.True(i < 99, "Following the returned continuation did not converge.");
        }
        Assert.Equal(2, pendingCleanup); Assert.NotNull(freshId);
        var current = await f.Student.GetFromJsonAsync<JsonElement>($"/api/v1/progress/me/pbe-cooperation?seasonId={f.Season}"); Assert.Equal("Provisional", current.GetProperty("state").GetString()); Assert.Equal(freshId, current.GetProperty("snapshotId").GetString());
        Assert.False(await f.Db.PbeTrainingRecords.AnyAsync(r => r.Kind == "pbe-cooperation-snapshot" && r.Id == abandonedId));
        foreach (var row in await f.Db.PbeTrainingRecords.AsNoTracking().Where(r => r.SeasonId == f.Season && (r.Kind.StartsWith("pbe-chapter-") || r.Id.StartsWith(completedId))).ToListAsync())
        { Assert.True(protectedRows.Remove(row.Kind + ":" + row.Id, out var expected)); Assert.Equal((expected!.DataJson, expected.Revision), (row.DataJson, row.Revision)); }
        Assert.Empty(protectedRows); await File.WriteAllTextAsync(Path.Combine(AppContext.BaseDirectory, "d2-canonical-cleanup-resource.json"), JsonSerializer.Serialize(metrics));
    }

}
