using System.Threading.RateLimiting;
using Erudoza.Api.Auth;
using Erudoza.Api.Endpoints;
using Erudoza.Application.Abstractions;
using Erudoza.Infrastructure;
using Erudoza.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

Erudoza.Api.Operations.ProductionSafety.Validate(builder.Configuration, builder.Environment);
if (!string.IsNullOrWhiteSpace(builder.Configuration["DataProtection:KeyPath"]))
    builder.Services.AddDataProtection().SetApplicationName("Erudoza")
        .PersistKeysToFileSystem(new DirectoryInfo(builder.Configuration["DataProtection:KeyPath"]!));
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("login", context => RateLimitPartition.GetFixedWindowLimiter(
        context.Connection.RemoteIpAddress?.ToString() ?? "unknown", _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = builder.Configuration.GetValue("RateLimiting:LoginPermitLimit", 10),
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
            AutoReplenishment = true
        }));
    options.OnRejected = async (context, token) =>
    {
        context.HttpContext.Response.Headers.RetryAfter = "60";
        await context.HttpContext.Response.WriteAsJsonAsync(new { title = "Too many sign-in attempts. Try again in a minute." }, token);
    };
});
builder.Services.AddErudozaInfrastructure(builder.Configuration);
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<Erudoza.Api.Practice.PracticeRuntime>();
builder.Services.AddScoped<Erudoza.Api.Practice.PracticeService>();
builder.Services.AddSignalR(options => options.MaximumReceiveMessageSize = 32 * 1024);
builder.Services.AddHostedService<Erudoza.Api.Practice.PracticeTicker>();
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
        options.Cookie.SecurePolicy = builder.Environment.IsProduction() ? CookieSecurePolicy.Always : CookieSecurePolicy.SameAsRequest;
        options.Events.OnValidatePrincipal = SessionValidation.ValidateAsync;
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
app.UseMiddleware<Erudoza.Api.Practice.PracticeIngressMiddleware>();
app.UseCors("spa");
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

if (await Erudoza.Api.Operations.AdministratorOperations.RunAsync(app, args)) return;

if (!app.Environment.IsEnvironment("Testing") && app.Configuration.GetValue("Database:ApplySchema", app.Environment.IsDevelopment()))
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
    await DatabaseSchemaUpgrade.ApplyAsync(db);
    if (app.Environment.IsDevelopment() && app.Configuration.GetValue("Seed:Enabled", false))
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

if (app.Environment.IsDevelopment()) app.MapOpenApi().AllowAnonymous();
app.MapErudozaApi();
app.MapLifecycleEndpoints();
app.MapScriptureReaderEndpoints();
Erudoza.Api.Practice.PracticeEndpoints.MapPractice(app);
app.Run();

public partial class Program;
