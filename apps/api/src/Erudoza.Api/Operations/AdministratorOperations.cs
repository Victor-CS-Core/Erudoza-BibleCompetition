using Erudoza.Application.Abstractions;
using Erudoza.Application.Competitions;
using Erudoza.Domain;
using Erudoza.Infrastructure.Content;
using Erudoza.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Erudoza.Api.Operations;

public static class AdministratorOperations
{
    public static async Task<bool> RunAsync(WebApplication app, string[] args)
    {
        var migrate = args.Contains("--migrate-only");
        var bootstrap = args.Contains("--bootstrap-admin");
        var reset = args.Contains("--reset-admin-password");
        var installLibrary = args.Contains("--install-nkjv-library");
        if (!migrate && !bootstrap && !reset && !installLibrary) return false;
        if ((migrate ? 1 : 0) + (bootstrap ? 1 : 0) + (reset ? 1 : 0) + (installLibrary ? 1 : 0) != 1)
            throw new InvalidOperationException("Run one maintenance operation at a time.");
        using var scope = app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
        if (installLibrary)
        {
            var path = app.Configuration["Library:ManifestPath"];
            if (string.IsNullOrWhiteSpace(path)) throw new InvalidOperationException("Set Library:ManifestPath to the server-only content/nkjv/library-manifest.json file.");
            await scope.ServiceProvider.GetRequiredService<BuiltInLibraryInstaller>().InstallAsync(path);
            app.Logger.LogInformation("The immutable NKJV library installation is verified.");
            return true;
        }
        if (migrate)
        {
            await DatabaseSchemaUpgrade.ApplyAsync(db);
            app.Logger.LogInformation("Database migration completed.");
            return true;
        }
        var email = app.Configuration["Operations:AdminEmail"]?.Trim().ToLowerInvariant();
        var password = app.Configuration["Operations:AdminPassword"];
        if (string.IsNullOrWhiteSpace(email) || !email.Contains('@') || string.IsNullOrEmpty(password) || password.Length < 12)
            throw new InvalidOperationException("Set Operations:AdminEmail and Operations:AdminPassword (at least 12 characters).");
        var hasher = scope.ServiceProvider.GetRequiredService<IPasswordHasher>();
        await using var transaction = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable);
        if (reset)
        {
            var user = await db.Users.SingleOrDefaultAsync(x => x.Email == email || x.UserName == email);
            if (user is null || !await db.OrganizationMembers.AnyAsync(x => x.UserId == user.Id && (x.Role == OrganizationRole.Owner || x.Role == OrganizationRole.Admin)))
                throw new InvalidOperationException("No coach account matches the supplied email.");
            user.PasswordHash = hasher.Hash(password);
            user.SecurityStamp = Guid.NewGuid().ToString("N");
        }
        else
        {
            if (await db.Users.AnyAsync() || await db.Organizations.AnyAsync(o => o.Id != BuiltInLibrary.OrganizationId))
                throw new InvalidOperationException("Bootstrap requires an empty installation. Use account recovery for an existing coach.");
            var name = app.Configuration["Operations:OrganizationName"]?.Trim();
            if (string.IsNullOrWhiteSpace(name)) throw new InvalidOperationException("Set Operations:OrganizationName.");
            var now = DateTimeOffset.UtcNow;
            var org = new Organization { Id = Guid.NewGuid(), Name = name, Slug = "academy-" + Guid.NewGuid().ToString("N"), CreatedAtUtc = now };
            var user = new ApplicationUser { Id = Guid.NewGuid(), UserName = email, Email = email, PasswordHash = hasher.Hash(password), DisplayName = "Coach", Kind = UserKind.Adult, CreatedAtUtc = now, SecurityStamp = Guid.NewGuid().ToString("N") };
            db.Organizations.Add(org);
            db.Users.Add(user);
            db.OrganizationMembers.Add(new OrganizationMember { Id = Guid.NewGuid(), OrganizationId = org.Id, UserId = user.Id, Role = OrganizationRole.Owner, CreatedAtUtc = now });
            if (!await db.RuleProfiles.AnyAsync(x => x.Key == RuleProfileReader.PbeStyleV1))
                db.RuleProfiles.Add(new RuleProfile { Id = Guid.NewGuid(), Key = RuleProfileReader.PbeStyleV1, Version = 1, ConfigurationJson = RuleProfileReader.PbeStyleV1Json, IsBuiltIn = true, CreatedAtUtc = now });
        }
        await db.SaveChangesAsync();
        await transaction.CommitAsync();
        app.Logger.LogInformation("Administrator maintenance completed. Existing sessions for a recovered account are invalidated.");
        return true;
    }
}
