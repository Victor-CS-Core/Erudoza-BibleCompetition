using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Application.Contracts;
using Erudoza.Domain;
using Erudoza.Domain.Study;
using Erudoza.Infrastructure.Persistence;
using FluentAssertions;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Erudoza.IntegrationTests;

public sealed class MissingWordAnswerTests(ErudozaApiFactory factory) : IClassFixture<ErudozaApiFactory>
{
    private const string Root = "/api/v1/study/sessions";

    [Fact]
    public async Task Http_grading_preserves_positions_empty_slots_and_existing_normalization()
    {
        var (client, season) = await Setup();
        var cases = new (string[] Expected, string[] Entered, bool Correct)[]
        {
            (["in", "the"], ["in the", ""], false),
            (["in", "the"], ["the", "in"], false),
            (["in", "the", "beginning"], ["in", "", "beginning"], false),
            (["the", "the"], ["the", "the"], true),
            (["King’s", "well-known", "in  the", "letters,"], [" KING'S ", "WELL-KNOWN", "in\t the", "LETTERS"], true),
            (["a,b", "!"], ["ab", " ! "], true),
            (["well-known"], ["wellknown"], false),
            (["!"], [""], false),
            (["!"], ["?"], false),
            (["in", "the"], ["", " "], false)
        };
        foreach (var item in cases)
        {
            var (session, card) = await Card(client, season, item.Expected);
            var answers = item.Entered.Select((text, i) => new { index = i + 2, text }).Reverse().ToArray();
            var response = await client.PostAsJsonAsync($"{Root}/{session}/attempts", new { clientSubmissionId = "slots", challengeCardId = card, missingWordAnswers = answers, responseTimeMs = 100, hintsUsed = false });
            response.StatusCode.Should().Be(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
            var result = await response.Content.ReadFromJsonAsync<JsonElement>();
            result.GetProperty("isCorrect").GetBoolean().Should().Be(item.Correct);
            var slots = result.GetProperty("missingWordResults").EnumerateArray().ToArray();
            slots.Select(x => x.GetProperty("index").GetInt32()).Should().Equal(Enumerable.Range(2, item.Expected.Length));
            slots.Select(x => x.GetProperty("expected").GetString()).Should().Equal(item.Expected);
            var resumed = await client.GetFromJsonAsync<JsonElement>($"{Root}/{session}");
            resumed.GetProperty("attempt").GetProperty("missingWordAnswers").EnumerateArray().Select(a => a.GetProperty("text").GetString()).Should().Equal(item.Entered);
            if (!item.Correct) result.GetProperty("exactWordingScore").GetInt32().Should().BeLessThanOrEqualTo(70);
        }
    }

    [Fact]
    public async Task Http_rejects_malformed_slot_sets_XOR_and_aggregate_limits_without_writing_evidence()
    {
        var (client, season) = await Setup();
        var (session, card) = await Card(client, season, ["in", "the"]);
        var variants = new[]
        {
            "\"missingWordAnswers\":[{\"index\":2,\"text\":\"in\"}]",
            "\"missingWordAnswers\":[{\"index\":2,\"text\":\"in\"},{\"index\":2,\"text\":\"the\"}]",
            "\"missingWordAnswers\":[{\"index\":0,\"text\":\"in\"},{\"index\":3,\"text\":\"the\"}]",
            "\"missingWordAnswers\":[{\"index\":99,\"text\":\"in\"},{\"index\":3,\"text\":\"the\"}]",
            "\"missingWordAnswers\":[{\"index\":2.5,\"text\":\"in\"},{\"index\":3,\"text\":\"the\"}]",
            "\"missingWordAnswers\":[{\"index\":\"2\",\"text\":\"in\"},{\"index\":3,\"text\":\"the\"}]",
            "\"missingWordAnswers\":[{\"index\":2,\"text\":null},{\"index\":3,\"text\":\"the\"}]",
            "\"missingWordAnswers\":[{\"index\":2},{\"index\":3,\"text\":\"the\"}]",
            "\"missingWordAnswers\":[null,{\"index\":3,\"text\":\"the\"}]",
            "\"missingWordAnswers\":{}", "\"missingWordAnswers\":null", "\"submittedAnswer\":null",
            "\"submittedAnswer\":\"in the\",\"missingWordAnswers\":null",
            "\"submittedAnswer\":null,\"missingWordAnswers\":[{\"index\":2,\"text\":\"in\"},{\"index\":3,\"text\":\"the\"}]",
            "\"submittedAnswer\":\"in the\",\"missingWordAnswers\":[{\"index\":2,\"text\":\"in\"},{\"index\":3,\"text\":\"the\"}]",
            "\"missingWordAnswers\":[{\"index\":2,\"text\":\"in\",\"expected\":\"in\"},{\"index\":3,\"text\":\"the\"}]",
            "\"missingWordAnswers\":[{\"index\":2,\"text\":\"" + new string('x', 50001) + "\"},{\"index\":3,\"text\":\"" + new string('x', 50000) + "\"}]"
        };
        foreach (var fields in variants)
        {
            var json = $$"""{"clientSubmissionId":"bad","challengeCardId":"{{card}}","responseTimeMs":100,"hintsUsed":false,{{fields}}}""";
            var response = await client.PostAsync($"{Root}/{session}/attempts", new StringContent(json, Encoding.UTF8, "application/json"));
            response.StatusCode.Should().Be(HttpStatusCode.BadRequest, fields[..Math.Min(fields.Length, 160)]);
        }
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<IErudozaDbContext>();
        (await db.Attempts.CountAsync(a => a.SessionId == session)).Should().Be(0);
        (await db.MasteryStates.CountAsync(a => a.SeasonId == season)).Should().Be(0);
        var saved = await db.ChallengeCards.SingleAsync(c => c.Id == card);
        saved.ActivityType = "WhatComesNext";
        await db.SaveChangesAsync();
        (await client.PostAsJsonAsync($"{Root}/{session}/attempts", Body(card, "wrong-activity", "in", "the"))).StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Lost_response_resume_and_retry_preserve_raw_indexed_identity_and_original_results()
    {
        var (client, season) = await Setup();
        var (session, card) = await Card(client, season, ["in", "the"]);
        var url = $"{Root}/{session}/attempts";
        var original = Body(card, "lost", " in ", "THE");
        (await client.PostAsJsonAsync(url, original)).EnsureSuccessStatusCode(); // Deliberately discard response.
        var resumed = await client.GetFromJsonAsync<JsonElement>($"{Root}/{session}");
        var accepted = resumed.GetProperty("attempt");
        accepted.GetProperty("isCorrect").GetBoolean().Should().BeTrue();
        var expectedResults = accepted.GetProperty("missingWordResults").GetRawText();
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<IErudozaDbContext>();
            var persisted = await db.Attempts.SingleAsync(a => a.ChallengeCardId == card);
            var raw = JsonSerializer.Deserialize<JsonElement>(persisted.AnswerPayloadJson!);
            raw.GetProperty("format").GetString().Should().Be("missing-words-slots/v1");
            raw.GetProperty("answers").EnumerateArray().Select(a => a.GetProperty("text").GetString()).Should().Equal(" in ", "THE");
            raw.GetProperty("results").GetRawText().Should().Be(expectedResults);
            persisted.SubmittedAnswer.Should().Be(" in  THE");
            var saved = await db.ChallengeCards.SingleAsync(c => c.Id == card);
            var payload = ActivitySerialization.ReadPayload(saved.PayloadJson);
            saved.PayloadJson = ActivitySerialization.Payload(payload with { Tokens = [new("changed", true, 99)] });
            saved.AnswerKeyJson = ActivitySerialization.AnswerKey("changed");
            await db.SaveChangesAsync();
        }
        var reordered = new { clientSubmissionId = "lost", challengeCardId = card, missingWordAnswers = new[] { new { index = 3, text = "THE" }, new { index = 2, text = " in " } }, responseTimeMs = 100, hintsUsed = false };
        var retry = await client.PostAsJsonAsync(url, reordered);
        retry.EnsureSuccessStatusCode();
        var replay = await retry.Content.ReadFromJsonAsync<JsonElement>();
        replay.GetProperty("attemptId").GetGuid().Should().Be(accepted.GetProperty("attemptId").GetGuid());
        replay.GetProperty("missingWordResults").GetRawText().Should().Be(expectedResults);
        foreach (var different in new object[] { Body(card, "lost", "in", "THE"), Body(card, "lost", " in", " THE"), new { clientSubmissionId = "lost", challengeCardId = card, submittedAnswer = " in  THE", responseTimeMs = 100, hintsUsed = false }, new { clientSubmissionId = "lost", challengeCardId = card, missingWordAnswers = new[] { new { index = 2, text = " in " }, new { index = 3, text = "THE" } }, responseTimeMs = 101, hintsUsed = false } })
            (await client.PostAsJsonAsync(url, different)).StatusCode.Should().Be(HttpStatusCode.Conflict);
        using var verification = factory.Services.CreateScope();
        var verify = verification.ServiceProvider.GetRequiredService<IErudozaDbContext>();
        (await verify.Attempts.CountAsync(a => a.SessionId == session)).Should().Be(1);
    }

    [Fact]
    public async Task Legacy_text_meaning_retries_and_feedback_remain_unchanged()
    {
        var (client, season) = await Setup();
        var (session, card) = await Card(client, season, ["in", "the"]);
        var pending = await client.GetFromJsonAsync<JsonElement>($"{Root}/{session}");
        pending.GetProperty("attempt").ValueKind.Should().Be(JsonValueKind.Null);
        var body = new { clientSubmissionId = "legacy", challengeCardId = card, submittedAnswer = "in, the", responseTimeMs = 100, hintsUsed = false };
        var accepted = await (await client.PostAsJsonAsync($"{Root}/{session}/attempts", body)).Content.ReadFromJsonAsync<JsonElement>();
        accepted.GetProperty("isCorrect").GetBoolean().Should().BeTrue();
        var retry = await (await client.PostAsJsonAsync($"{Root}/{session}/attempts", body)).Content.ReadFromJsonAsync<JsonElement>();
        retry.GetProperty("alreadyProcessed").GetBoolean().Should().BeTrue();
        retry.GetProperty("attemptId").GetGuid().Should().Be(accepted.GetProperty("attemptId").GetGuid());
    }

    [Fact]
    public async Task Different_key_replays_cannot_admit_wrong_activity_or_unknown_slot_sets()
    {
        var (client, season) = await Setup();
        foreach (var activity in new[] { "MissingWords", "WhatComesNext" })
        {
            var (session, card) = await Card(client, season, ["in", "the"]);
            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<IErudozaDbContext>();
                (await db.ChallengeCards.SingleAsync(c => c.Id == card)).ActivityType = activity;
                await db.SaveChangesAsync();
            }
            var url = $"{Root}/{session}/attempts";
            (await client.PostAsJsonAsync(url, new { clientSubmissionId = "accepted", challengeCardId = card, submittedAnswer = "in the", responseTimeMs = 100, hintsUsed = false })).EnsureSuccessStatusCode();
            var answer = new { clientSubmissionId = "new-key", challengeCardId = card, missingWordAnswers = new[] { new { index = activity == "MissingWords" ? 99 : 2, text = "in" }, new { index = 3, text = "the" } }, responseTimeMs = 100, hintsUsed = false };
            (await client.PostAsJsonAsync(url, answer)).StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await client.PostAsJsonAsync(url, Body(card, "accepted", "in", "the"))).StatusCode.Should().Be(HttpStatusCode.Conflict);
            (await client.PostAsJsonAsync(url, new { clientSubmissionId = "accepted", challengeCardId = card, submittedAnswer = "changed", responseTimeMs = 100, hintsUsed = false })).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        }
    }

    [Fact]
    public async Task Structured_replays_require_submission_identity_timing_and_hints_fields()
    {
        var (client, season) = await Setup();
        var (session, card) = await Card(client, season, ["in", "the"]);
        var url = $"{Root}/{session}/attempts";
        (await client.PostAsJsonAsync(url, Body(card, "original", "in", "the"))).EnsureSuccessStatusCode();
        foreach (var (field, value) in new (string, object?)[] { ("clientSubmissionId", null), ("clientSubmissionId", " "), ("clientSubmissionId", new string('x', 201)), ("responseTimeMs", null), ("responseTimeMs", -1), ("responseTimeMs", 1.5), ("hintsUsed", null), ("hintsUsed", "false") })
        {
            var body = JsonSerializer.Deserialize<Dictionary<string, object?>>(JsonSerializer.Serialize(Body(card, "new-key", "in", "the")))!;
            body[field] = value;
            (await client.PostAsJsonAsync(url, body)).StatusCode.Should().Be(HttpStatusCode.BadRequest, field);
        }
    }

    [Fact]
    public async Task Structured_body_bound_counts_outer_whitespace_without_content_length()
    {
        var (client, season) = await Setup();
        var (session, card) = await Card(client, season, ["in", "the"]);
        var body = new string(' ', 1048576) + JsonSerializer.Serialize(Body(card, "oversize", "in", "the"));
        using var content = new ChunkedContent(body);
        content.Headers.ContentType = new("application/json");
        (await client.PostAsync($"{Root}/{session}/attempts", content)).StatusCode.Should().Be(HttpStatusCode.RequestEntityTooLarge);
        using var scope = factory.Services.CreateScope();
        (await scope.ServiceProvider.GetRequiredService<IErudozaDbContext>().Attempts.CountAsync(a => a.SessionId == session)).Should().Be(0);
        // Preserve canonical historical text admission, including its absence of a Memory body cap.
        var legacy = new string(' ', 1048576) + JsonSerializer.Serialize(new { clientSubmissionId = "large-legacy", challengeCardId = card, submittedAnswer = "in the", responseTimeMs = 100, hintsUsed = false });
        using var oldContent = new ChunkedContent(legacy);
        oldContent.Headers.ContentType = new("application/json");
        (await client.PostAsync($"{Root}/{session}/attempts", oldContent)).EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task Accepted_structured_and_legacy_Memory_attempts_survive_populated_database_backup()
    {
        var (client, season) = await Setup();
        var (session, card) = await Card(client, season, ["in", "the"]);
        var structured = Body(card, "backup-slots", " in ", "THE");
        (await client.PostAsJsonAsync($"{Root}/{session}/attempts", structured)).EnsureSuccessStatusCode();
        var (legacySession, legacyCard) = await Card(client, season, ["in", "the"]);
        (await client.PostAsJsonAsync($"{Root}/{legacySession}/attempts", new { clientSubmissionId = "backup-legacy", challengeCardId = legacyCard, submittedAnswer = "in, the", responseTimeMs = 100, hintsUsed = false })).EnsureSuccessStatusCode();
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
        var before = await db.Attempts.AsNoTracking().SingleAsync(a => a.ChallengeCardId == card);
        var path = Environment.GetEnvironmentVariable("B4_EXPORT_FIXTURE_PATH") ?? Path.Combine(Path.GetTempPath(), $"b4-memory-{Guid.NewGuid():N}.db");
        try
        {
            await db.Database.OpenConnectionAsync();
            await using (var target = new SqliteConnection($"Data Source={path}"))
            {
                await target.OpenAsync();
                ((SqliteConnection)db.Database.GetDbConnection()).BackupDatabase(target);
            }
            await using var restored = new ErudozaDbContext(new DbContextOptionsBuilder<ErudozaDbContext>().UseSqlite($"Data Source={path}").Options);
            var after = await restored.Attempts.AsNoTracking().SingleAsync(a => a.Id == before.Id);
            after.AnswerPayloadJson.Should().Be(before.AnswerPayloadJson);
            after.ResultJson.Should().Be(before.ResultJson);
            after.ClientSubmissionId.Should().Be("backup-slots"); after.ResponseTimeMs.Should().Be(100); after.HintsUsed.Should().BeFalse();
            (await restored.Attempts.SingleAsync(a => a.ChallengeCardId == legacyCard)).AnswerPayloadJson.Should().BeNull();
        }
        finally { if (Environment.GetEnvironmentVariable("B4_EXPORT_FIXTURE_PATH") is null) File.Delete(path); }
    }

    private sealed class ChunkedContent(string text) : HttpContent
    {
        protected override Task SerializeToStreamAsync(Stream stream, TransportContext? context) => stream.WriteAsync(Encoding.UTF8.GetBytes(text)).AsTask();
        protected override bool TryComputeLength(out long length) { length = 0; return false; }
    }

    private static object Body(Guid card, string key, params string[] values) => new { clientSubmissionId = key, challengeCardId = card, missingWordAnswers = values.Select((text, i) => new { index = i + 2, text }), responseTimeMs = 100, hintsUsed = false };

    private async Task<(Guid Session, Guid Card)> Card(HttpClient client, Guid seasonId, string[] expected)
    {
        var start = await client.PostAsJsonAsync(Root, new { seasonId }); start.EnsureSuccessStatusCode();
        var session = (await start.Content.ReadFromJsonAsync<SessionDto>())!.Id;
        var card = (await client.GetFromJsonAsync<ChallengeCardDto>($"{Root}/{session}/next"))!.Id;
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<IErudozaDbContext>();
        var saved = await db.ChallengeCards.SingleAsync(c => c.Id == card);
        var payload = ActivitySerialization.ReadPayload(saved.PayloadJson);
        saved.ActivityType = "MissingWords";
        saved.AnswerMode = AnswerMode.ExactText;
        saved.PayloadJson = ActivitySerialization.Payload(payload with { Tokens = new[] { new MissingWordsToken("visible", false, 0) }.Concat(expected.Select((text, i) => new MissingWordsToken(text, true, i + 2))).ToArray() });
        saved.AnswerKeyJson = ActivitySerialization.AnswerKey(string.Join(" ", expected), expected);
        await db.SaveChangesAsync();
        return (session, card);
    }

    private async Task<(HttpClient Client, Guid Season)> Setup()
    {
        var admin = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        var created = await admin.PostAsJsonAsync($"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/seasons", new { name = $"Slots {Guid.NewGuid():N}", yearLabel = "2026", ruleProfileKey = "PBE_STYLE_V1" });
        created.EnsureSuccessStatusCode();
        var season = (await created.Content.ReadFromJsonAsync<SeasonDto>())!.Id;
        var root = $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/seasons/{season}";
        var range = new { bookKey = "DAN", startChapter = 1, startVerse = 1, endChapter = 1, endVerse = 1 };
        (await admin.PostAsJsonAsync(root + "/scope", new { contentPackId = SeedIdentifiers.ContentPackId, includes = new[] { range }, excludes = Array.Empty<object>() })).EnsureSuccessStatusCode();
        (await admin.PostAsJsonAsync(root + "/assignments", new { studentUserId = SeedIdentifiers.StudentUserId, type = "PrimarySpecialist", contentPackId = SeedIdentifiers.ContentPackId, range })).EnsureSuccessStatusCode();
        (await admin.PostAsync(root + "/activate", null)).EnsureSuccessStatusCode();
        return (await TestHttp.LoginAsync(factory, "daniel.student", "DevStudent!234"), season);
    }
}
