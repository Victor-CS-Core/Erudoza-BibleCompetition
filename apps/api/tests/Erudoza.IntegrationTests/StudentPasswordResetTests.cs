using System.Net;
using System.Net.Http.Json;
using Erudoza.Application.Contracts;
using Erudoza.Domain;
using FluentAssertions;

namespace Erudoza.IntegrationTests;

public sealed class StudentPasswordResetTests(ErudozaApiFactory factory) : IClassFixture<ErudozaApiFactory>
{
    [Fact]
    public async Task Admin_can_reset_a_student_password_and_the_old_password_stops_working()
    {
        var admin = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        var userName = $"reset.student.{Guid.NewGuid():N}"[..24];
        var created = await admin.PostAsJsonAsync(
            $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/students",
            new { userName, displayName = "Reset Student", password = "OldPass!234" });
        created.EnsureSuccessStatusCode();
        var student = await created.Content.ReadFromJsonAsync<StudentDto>();
        student.Should().NotBeNull();

        var reset = await admin.PostAsJsonAsync(
            $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/students/{student!.UserId}/password",
            new { password = "NewPass!234" });
        reset.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var oldLogin = factory.CreateClient();
        var oldResponse = await oldLogin.PostAsJsonAsync("/api/v1/auth/login", new { identifier = userName, password = "OldPass!234" });
        oldResponse.StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        var next = await TestHttp.LoginAsync(factory, userName, "NewPass!234");
        var me = await next.GetFromJsonAsync<MeDto>("/api/v1/me");
        me!.UserName.Should().Be(userName);
        me.Kind.Should().Be("Student");
    }

    [Fact]
    public async Task Reset_rejects_short_passwords_and_adult_accounts()
    {
        var admin = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        var shortPassword = await admin.PostAsJsonAsync(
            $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/students/{SeedIdentifiers.StudentUserId}/password",
            new { password = "short" });
        shortPassword.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        var adult = await admin.PostAsJsonAsync(
            $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/students/{SeedIdentifiers.AdminUserId}/password",
            new { password = "AdminPass!234" });
        adult.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }
}
