using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Erudoza.Domain;
using Erudoza.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Erudoza.IntegrationTests;

public sealed class CharacterProfileTests(ErudozaApiFactory factory) : IClassFixture<ErudozaApiFactory>
{
    const string Key = "solo:exact-recall";
    static readonly Guid Org = SeedIdentifiers.OrganizationId, User = SeedIdentifiers.StudentUserId;
    static JsonObject Input(long version = 0) => new()
    {
        ["version"] = version,
        ["avatarKind"] = "character",
        ["avatarHonorKey"] = null,
        ["character"] = new JsonObject { ["bodyType"] = "female", ["style"] = "braids", ["hairColor"] = "red", ["skin"] = "deep", ["eyes"] = "blue", ["attire"] = "student", ["background"] = "starlight", ["slots"] = new JsonArray(null, null, null) },
        ["shareOptions"] = new JsonObject { ["showName"] = false, ["showBrand"] = true, ["showQR"] = false },
        ["sharePatches"] = new JsonArray()
    };
    static JsonObject Patch(string key = Key) => new() { ["key"] = key, ["x"] = 400, ["y"] = 1200, ["size"] = 216, ["rotation"] = 35 };
    static async Task<JsonObject> Read(HttpClient client) => (await client.GetFromJsonAsync<JsonObject>("/api/v1/profile/me"))!;
    static Task<HttpResponseMessage> Save(HttpClient client, JsonObject input) => client.PutAsJsonAsync("/api/v1/profile/me/character", input);
    async Task<HttpClient> Setup()
    {
        var client = await TestHttp.LoginAsync(factory, "daniel.student", "DevStudent!234");
        using var scope = factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
        await db.PbeTrainingRecords.Where(x => x.OrganizationId == Org && (x.Kind == "profile-character" || x.Kind == "simulation-eligibility")).ExecuteDeleteAsync();
        await db.ProfileAvatarSelections.Where(x => x.OrganizationId == Org).ExecuteDeleteAsync();
        await db.MasteryHonorUnlocks.Where(x => x.OrganizationId == Org).ExecuteDeleteAsync();
        var member = await db.OrganizationMembers.SingleAsync(x => x.OrganizationId == Org && x.UserId == User); member.Role = OrganizationRole.Student;
        (await db.Users.SingleAsync(x => x.Id == User)).Kind = UserKind.Student; await db.SaveChangesAsync(); return client;
    }
    async Task Earn(string key = Key, string version = "mastery-v1")
    {
        using var scope = factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
        db.MasteryHonorUnlocks.Add(new() { OrganizationId = Org, UserId = User, Key = key, RuleVersion = version, EarnedAtUtc = DateTimeOffset.UtcNow }); await db.SaveChangesAsync();
    }
    [Fact]
    public async Task Defaults_are_read_only_and_existing_Honor_selection_migrates()
    {
        var client = await Setup(); var before = await Read(client);
        Assert.Equal("initials", (string?)before["avatarKind"]); Assert.Equal(0, (int?)before["characterVersion"]); Assert.False((bool?)before["canUseMasterGuide"]);
        Assert.Equal("curls", (string?)before["character"]?["style"]); Assert.Equal("student", (string?)before["character"]?["attire"]); Assert.Equal(3, ((JsonArray)before["character"]!["slots"]!).Count); Assert.Empty((JsonArray)before["sharePatches"]!);
        using (var scope = factory.Services.CreateScope()) Assert.False(await scope.ServiceProvider.GetRequiredService<ErudozaDbContext>().PbeTrainingRecords.AnyAsync(x => x.Kind == "profile-character"));
        await Earn();
        using (var scope = factory.Services.CreateScope()) { var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>(); var unlock = await db.MasteryHonorUnlocks.SingleAsync(x => x.UserId == User); db.ProfileAvatarSelections.Add(new() { OrganizationId = Org, UserId = User, HonorKey = Key, UnlockId = unlock.Id, RuleVersion = "mastery-v1" }); await db.SaveChangesAsync(); }
        var migrated = await Read(client); Assert.Equal("honor", (string?)migrated["avatarKind"]); Assert.Equal(0, (int?)migrated["characterVersion"]);
    }
    [Fact]
    public async Task Save_reloads_earned_character_and_share_preferences_and_identity_is_portrait_only()
    {
        var client = await Setup(); await Earn(); var input = Input(); input["character"]!["slots"] = new JsonArray(null, Key, null); input["sharePatches"] = new JsonArray(Patch());
        var saved = await Save(client, input); Assert.Equal(HttpStatusCode.OK, saved.StatusCode); var reloaded = await Read(client);
        Assert.Equal(1, (int?)reloaded["characterVersion"]); Assert.True(JsonNode.DeepEquals(input["character"], reloaded["character"])); Assert.True(JsonNode.DeepEquals(input["shareOptions"], reloaded["shareOptions"])); Assert.True(JsonNode.DeepEquals(input["sharePatches"], reloaded["sharePatches"]));
        var identities = (await client.GetFromJsonAsync<JsonArray>($"/api/v1/profile/identities?userId={User}&userId={User}"))!; Assert.Single(identities);
        var identity = (JsonObject)identities[0]!; Assert.Equal(4, identity.Count); Assert.Equal("character", (string?)identity["avatarKind"]); var head = (JsonObject)identity["character"]!; Assert.Equal(5, head.Count); Assert.Equal("braids", (string?)head["style"]); Assert.False(head.ContainsKey("slots"));
    }
    [Fact]
    public async Task Concurrent_create_and_update_allow_one_winner_and_preserve_legacy_avatar_consistency()
    {
        var client = await Setup(); await Earn();
        foreach (var version in new[] { 0, 1 })
        {
            var first = Input(version); var second = Input(version); second["avatarKind"] = "honor"; second["avatarHonorKey"] = Key;
            var responses = await Task.WhenAll(Save(client, first), Save(client, second)); Assert.Single(responses, r => r.StatusCode == HttpStatusCode.OK); Assert.Single(responses, r => r.StatusCode == HttpStatusCode.Conflict);
            var winner = await responses.Single(r => r.StatusCode == HttpStatusCode.OK).Content.ReadFromJsonAsync<JsonObject>(); Assert.True(JsonNode.DeepEquals(winner, await Read(client)));
        }
        Assert.Equal(HttpStatusCode.Conflict, (await Save(client, Input())).StatusCode);
    }
    [Fact]
    public async Task Malformed_configuration_and_patch_bounds_are_rejected_without_persistence()
    {
        var client = await Setup(); await Earn();
        foreach (var (field, value) in new[] { ("bodyType", "other"), ("style", "curls"), ("hairColor", "green"), ("skin", "pink"), ("eyes", "red"), ("attire", "costume"), ("background", "void") }) { var input = Input(); input["character"]![field] = value; Assert.Equal(HttpStatusCode.BadRequest, (await Save(client, input)).StatusCode); }
        foreach (var slots in new[] { new JsonArray((JsonNode?)null), new JsonArray(Key, Key, null), new JsonArray("unknown", null, null) }) { var input = Input(); input["character"]!["slots"] = slots; Assert.Equal(HttpStatusCode.BadRequest, (await Save(client, input)).StatusCode); }
        foreach (var (field, value) in new[] { ("x", -1), ("x", 1201), ("y", 1601), ("size", 143), ("size", 337), ("rotation", 181) }) { var input = Input(); var patch = Patch(); patch[field] = value; input["sharePatches"] = new JsonArray(patch); Assert.Equal(HttpStatusCode.BadRequest, (await Save(client, input)).StatusCode); }
        var duplicate = Input(); duplicate["sharePatches"] = new JsonArray(Patch(), Patch()); Assert.Equal(HttpStatusCode.BadRequest, (await Save(client, duplicate)).StatusCode);
        var missing = Input(); missing.Remove("version"); Assert.Equal(HttpStatusCode.BadRequest, (await Save(client, missing)).StatusCode);
        var switches = Input(); switches["shareOptions"]!.AsObject().Remove("showQR"); Assert.Equal(HttpStatusCode.BadRequest, (await Save(client, switches)).StatusCode);
        Assert.Equal(0, (int?)(await Read(client))["characterVersion"]);
    }
    [Fact]
    public async Task Locked_Honors_and_Student_Master_Guide_are_forbidden_but_coach_attire_is_allowed()
    {
        var client = await Setup();
        var sash = Input(); sash["character"]!["slots"] = new JsonArray(Key, null, null); var patch = Input(); patch["sharePatches"] = new JsonArray(Patch()); var avatar = Input(); avatar["avatarHonorKey"] = Key;
        foreach (var input in new[] { sash, patch, avatar }) Assert.Equal(HttpStatusCode.Forbidden, (await Save(client, input)).StatusCode);
        var coach = Input(); coach["character"]!["attire"] = "coach"; Assert.Equal(HttpStatusCode.Forbidden, (await Save(client, coach)).StatusCode);
        var admin = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234"); Assert.True((bool?)(await Read(admin))["canUseMasterGuide"]); Assert.Equal(HttpStatusCode.OK, (await Save(admin, coach)).StatusCode);
        using (var scope = factory.Services.CreateScope()) { var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>(); (await db.OrganizationMembers.SingleAsync(x => x.OrganizationId == Org && x.UserId == SeedIdentifiers.AdminUserId)).Role = OrganizationRole.Student; await db.SaveChangesAsync(); }
        Assert.Equal(HttpStatusCode.Unauthorized, (await admin.GetAsync("/api/v1/profile/me")).StatusCode);
        admin = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        Assert.Equal("student", (string?)(await Read(admin))["character"]?["attire"]);
        using (var scope = factory.Services.CreateScope()) { var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>(); (await db.OrganizationMembers.SingleAsync(x => x.OrganizationId == Org && x.UserId == SeedIdentifiers.AdminUserId)).Role = OrganizationRole.Owner; await db.SaveChangesAsync(); }
    }
    [Fact]
    public async Task Legacy_avatar_changes_preserve_settings_and_advance_revision()
    {
        var client = await Setup(); var input = Input(); Assert.Equal(HttpStatusCode.OK, (await Save(client, input)).StatusCode); await Earn();
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync("/api/v1/profile/me/avatar", new { honorKey = Key })).StatusCode);
        var updated = await Read(client); Assert.Equal("honor", (string?)updated["avatarKind"]); Assert.Equal(2, (int?)updated["characterVersion"]); Assert.True(JsonNode.DeepEquals(input["character"], updated["character"])); Assert.True(JsonNode.DeepEquals(input["shareOptions"], updated["shareOptions"]));
        Assert.Equal(HttpStatusCode.Conflict, (await Save(client, Input(1))).StatusCode); (await client.PutAsJsonAsync("/api/v1/profile/me/avatar", new { honorKey = (string?)null })).EnsureSuccessStatusCode(); Assert.Equal("initials", (string?)(await Read(client))["avatarKind"]); Assert.Equal(3, (int?)(await Read(client))["characterVersion"]);
    }
    [Fact]
    public async Task Lost_simulation_eligibility_removes_decorations_without_deleting_unlock()
    {
        var client = await Setup(); const string simulation = "simulation:team-precision"; await Earn(simulation, "simulation-v1");
        using (var scope = factory.Services.CreateScope()) { var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>(); db.PbeTrainingRecords.Add(new() { OrganizationId = Org, Kind = "simulation-eligibility", Id = "eligible", OwnerId = User, DataJson = "{\"key\":\"simulation:team-precision\"}" }); await db.SaveChangesAsync(); }
        var input = Input(); input["character"]!["slots"] = new JsonArray(simulation, null, null); input["sharePatches"] = new JsonArray(Patch(simulation)); Assert.Equal(HttpStatusCode.OK, (await Save(client, input)).StatusCode);
        using (var scope = factory.Services.CreateScope()) { var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>(); await db.PbeTrainingRecords.Where(x => x.Kind == "simulation-eligibility").ExecuteDeleteAsync(); }
        var current = await Read(client); Assert.All((JsonArray)current["character"]!["slots"]!, Assert.Null); Assert.Empty((JsonArray)current["sharePatches"]!); input["version"] = 1; Assert.Equal(HttpStatusCode.Forbidden, (await Save(client, input)).StatusCode);
        using var verify = factory.Services.CreateScope(); Assert.Single(await verify.ServiceProvider.GetRequiredService<ErudozaDbContext>().MasteryHonorUnlocks.Where(x => x.UserId == User).ToListAsync());
    }
    [Fact]
    public async Task Character_records_are_owned_and_identities_exclude_foreign_and_inactive_users()
    {
        var client = await Setup(); var foreignOrg = Guid.NewGuid(); var foreignUser = Guid.NewGuid(); var inactive = Guid.NewGuid();
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>(); db.Organizations.Add(new() { Id = foreignOrg, Name = "Foreign", Slug = foreignOrg.ToString() });
            foreach (var (user, org, active) in new[] { (foreignUser, foreignOrg, true), (inactive, Org, false) }) { db.Users.Add(new() { Id = user, UserName = user.ToString(), DisplayName = "Fixture", IsActive = active }); db.OrganizationMembers.Add(new() { Id = Guid.NewGuid(), OrganizationId = org, UserId = user, Role = OrganizationRole.Student }); }
            var state = Input(); state["userId"] = foreignUser.ToString(); db.PbeTrainingRecords.Add(new() { OrganizationId = Org, Kind = "profile-character", Id = User.ToString(), OwnerId = foreignUser, DataJson = state.ToJsonString() }); await db.SaveChangesAsync();
        }
        Assert.Equal("initials", (string?)(await Read(client))["avatarKind"]); Assert.Equal(0, (int?)(await Read(client))["characterVersion"]);
        var identities = (await client.GetFromJsonAsync<JsonArray>($"/api/v1/profile/identities?userId={User}&userId={foreignUser}&userId={inactive}"))!; Assert.Single(identities); Assert.Equal("initials", (string?)identities[0]!["avatarKind"]);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Save(factory.CreateClient(), Input())).StatusCode);
    }
}
