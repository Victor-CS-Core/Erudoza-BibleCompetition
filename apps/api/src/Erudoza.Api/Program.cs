using Erudoza.Api.Auth;
using Erudoza.Api.Endpoints;
using Erudoza.Application.Abstractions;
using Erudoza.Infrastructure;
using Erudoza.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddErudozaInfrastructure(builder.Configuration);
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<ICurrentUser, HttpCurrentUser>();
builder.Services.AddScoped<ICorrelationIdAccessor, HttpCorrelationIdAccessor>();
builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter());
    options.SerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
});
builder.Services.AddOpenApi();
builder.Services.AddProblemDetails();
builder.Logging.AddJsonConsole();

builder.Services.AddAuthentication(ApiEndpoints.CookieScheme)
    .AddCookie(ApiEndpoints.CookieScheme, options =>
    {
        options.Cookie.Name = "erudoza.auth";
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Lax;
        options.SlidingExpiration = true;
        options.ExpireTimeSpan = TimeSpan.FromHours(12);
        options.Events.OnRedirectToLogin = context =>
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return Task.CompletedTask;
        };
        options.Events.OnRedirectToAccessDenied = context =>
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return Task.CompletedTask;
        };
    });

builder.Services.AddAuthorizationBuilder()
    .AddPolicy("OrgAdmin", policy => policy.RequireRole("Owner", "Admin"))
    .AddPolicy("CanManageSeason", policy => policy.RequireRole("Owner", "Admin"))
    .AddPolicy("CanManageStudents", policy => policy.RequireRole("Owner", "Admin"))
    .AddPolicy("CanManageContent", policy => policy.RequireRole("Owner", "Admin"))
    .AddPolicy("CanReviewQuestions", policy => policy.RequireRole("Owner", "Admin"))
    .AddPolicy("CanStudy", policy => policy.RequireRole("Student"))
    .AddPolicy("CanViewOwnProgress", policy => policy.RequireAuthenticatedUser())
    .SetFallbackPolicy(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build());

builder.Services.AddCors(options =>
{
    options.AddPolicy("spa", policy =>
    {
        var origin = builder.Configuration["PUBLIC_ORIGIN"] ?? "http://localhost:5173";
        policy.WithOrigins(origin)
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials();
    });
});

var app = builder.Build();

app.UseMiddleware<CorrelationMiddleware>();
app.UseMiddleware<ExceptionMappingMiddleware>();
app.UseCors("spa");
app.UseAuthentication();
app.UseAuthorization();

if (!app.Environment.IsEnvironment("Testing") && app.Configuration.GetValue("Database:ApplySchema", true))
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
    await db.Database.EnsureCreatedAsync();
    if (app.Configuration.GetValue("Seed:Enabled", true))
    {
        var seeder = scope.ServiceProvider.GetRequiredService<DevelopmentSeeder>();
        await seeder.SeedAsync(
            app.Configuration["Seed:AdminEmail"] ?? "admin@erudoza.local",
            app.Configuration["Seed:AdminPassword"] ?? "DevAdmin!234",
            app.Configuration["Seed:StudentUsername"] ?? "daniel.student",
            app.Configuration["Seed:StudentPassword"] ?? "DevStudent!234",
            CancellationToken.None);
    }
}

app.MapOpenApi().AllowAnonymous();
app.MapErudozaApi();
app.Run();

public partial class Program;
