using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Erudoza.Domain;

namespace Erudoza.IntegrationTests;

public class PracticeHttpTests
{
    [Fact]
    public async Task Practice_is_opt_in_and_only_coaches_can_enable_it()
    {
        using var factory = new ErudozaApiFactory();
        using var admin = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        var me = await admin.GetFromJsonAsync<JsonElement>("/api/v1/me");
        var org = me.GetProperty("organizationId").GetGuid();
        var path = $"/api/v1/organizations/{org}/practice";
        var bootstrap = await admin.GetFromJsonAsync<JsonElement>(path + "/bootstrap");
        Assert.False(bootstrap.GetProperty("enabled").GetBoolean());
        (await admin.PostAsJsonAsync(path + "/enabled", new { enabled = true })).EnsureSuccessStatusCode();
        using var student = await TestHttp.LoginAsync(factory, "daniel.student", "DevStudent!234");
        Assert.Equal(HttpStatusCode.Forbidden, (await student.PostAsJsonAsync(path + "/enabled", new { enabled = false })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.GetAsync($"/api/v1/organizations/{Guid.NewGuid()}/practice/bootstrap")).StatusCode);
    }

    [Fact]
    public async Task Invalid_question_import_is_rejected_atomically()
    {
        using var factory = new ErudozaApiFactory();
        using var admin = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        var me = await admin.GetFromJsonAsync<JsonElement>("/api/v1/me");
        var path = $"/api/v1/organizations/{me.GetProperty("organizationId").GetGuid()}/practice";
        (await admin.PostAsJsonAsync(path + "/enabled", new { enabled = true })).EnsureSuccessStatusCode();
        var response = await admin.PostAsJsonAsync(path + "/questions/import", new { seasonId = Guid.NewGuid(), questions = new[] { new { prompt = "Invalid", kind = "MultipleChoice" } } });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var bootstrap = await admin.GetFromJsonAsync<JsonElement>(path + "/bootstrap");
        Assert.Empty(bootstrap.GetProperty("questions").EnumerateArray());
    }
}
