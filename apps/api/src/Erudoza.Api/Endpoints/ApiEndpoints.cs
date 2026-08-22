using System.Security.Claims;
using Erudoza.Application.Abstractions;
using Erudoza.Application.Competitions;
using Erudoza.Application.Content;
using Erudoza.Application.Contracts;
using Erudoza.Application.Identity;
using Erudoza.Application.Mapping;
using Erudoza.Application.Study;
using Erudoza.Domain;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;

namespace Erudoza.Api.Endpoints;

public static class ApiEndpoints
{
    public const string CookieScheme = "Erudoza";

    public static void MapErudozaApi(this WebApplication app)
    {
        app.MapGet("/api/v1/health", async (IErudozaDbContext db, IBlobStorage blob, CancellationToken cancellationToken) =>
        {
            var canQuery = await db.Organizations.AsNoTracking().AnyAsync(cancellationToken);
            return Results.Ok(new
            {
                status = "ok",
                database = canQuery || true,
                blob = await blob.IsHealthyAsync(cancellationToken),
                utc = DateTimeOffset.UtcNow
            });
        }).AllowAnonymous();

        app.MapPost("/api/v1/auth/login", async (
            LoginRequest request,
            IErudozaDbContext db,
            IPasswordHasher hasher,
            HttpContext http,
            CancellationToken cancellationToken) =>
        {
            var identifier = request.Identifier.Trim().ToLowerInvariant();
            var user = await db.Users.SingleOrDefaultAsync(
                item => item.UserName == identifier || item.Email == identifier,
                cancellationToken);
            if (user is null || !hasher.Verify(user.PasswordHash, request.Password) || !user.IsActive)
            {
                return Results.Problem(statusCode: StatusCodes.Status401Unauthorized, title: "Invalid credentials.");
            }

            var membership = await db.OrganizationMembers
                .Include(item => item.Organization)
                .FirstOrDefaultAsync(item => item.UserId == user.Id, cancellationToken);
            if (membership is null)
            {
                return Results.Problem(statusCode: StatusCodes.Status403Forbidden, title: "No organization membership.");
            }

            var claims = new List<Claim>
            {
                new("sub", user.Id.ToString()),
                new("org", membership.OrganizationId.ToString()),
                new("kind", user.Kind.ToString()),
                new(ClaimTypes.Role, membership.Role.ToString()),
                new("name", user.DisplayName),
                new("username", user.UserName)
            };
            var identity = new ClaimsIdentity(claims, CookieScheme);
            await http.SignInAsync(CookieScheme, new ClaimsPrincipal(identity));
            return Results.Ok(ToMe(user, membership));
        }).AllowAnonymous();

        app.MapPost("/api/v1/auth/logout", async (HttpContext http) =>
        {
            await http.SignOutAsync(CookieScheme);
            return Results.NoContent();
        }).AllowAnonymous();

        app.MapGet("/api/v1/me", async (ICurrentUser current, IErudozaDbContext db, CancellationToken cancellationToken) =>
        {
            var user = await db.Users.SingleAsync(item => item.Id == current.UserId, cancellationToken);
            var membership = await db.OrganizationMembers
                .Include(item => item.Organization)
                .SingleAsync(item => item.UserId == current.UserId && item.OrganizationId == current.OrganizationId, cancellationToken);
            return Results.Ok(ToMe(user, membership));
        }).RequireAuthorization();

        var org = app.MapGroup("/api/v1/organizations/{orgId:guid}").RequireAuthorization();

        org.MapGet("", async (Guid orgId, ICurrentUser current, IErudozaDbContext db, CancellationToken cancellationToken) =>
        {
            if (orgId != current.OrganizationId)
            {
                return Results.Problem(statusCode: StatusCodes.Status403Forbidden, title: "Organization access denied.");
            }

            var organization = await db.Organizations.AsNoTracking().SingleAsync(item => item.Id == orgId, cancellationToken);
            return Results.Ok(new OrganizationDto(organization.Id, organization.Name, organization.Slug));
        });

        org.MapGet("/seasons", async (Guid orgId, ICurrentUser current, IErudozaDbContext db, ICompetitionScopeResolver resolver, CancellationToken cancellationToken) =>
        {
            if (ForbidOrg(orgId, current) is { } forbidden)
            {
                return forbidden;
            }

            var seasons = await db.Seasons.AsNoTracking()
                .Where(item => item.OrganizationId == orgId)
                .OrderByDescending(item => item.CreatedAtUtc)
                .ToListAsync(cancellationToken);
            var result = new List<SeasonDto>();
            foreach (var season in seasons)
            {
                result.Add(await MapSeason(db, resolver, season, cancellationToken));
            }

            return Results.Ok(result);
        });

        org.MapPost("/seasons", async (
            Guid orgId,
            CreateSeasonRequest request,
            ICurrentUser current,
            SeasonWorkflowService seasons,
            IErudozaDbContext db,
            ICompetitionScopeResolver resolver,
            CancellationToken cancellationToken) =>
        {
            if (ForbidAdmin(orgId, current) is { } forbidden)
            {
                return forbidden;
            }

            var season = await seasons.CreateAsync(orgId, request, cancellationToken);
            return Results.Created($"/api/v1/organizations/{orgId}/seasons/{season.Id}", await MapSeason(db, resolver, season, cancellationToken));
        }).RequireAuthorization("CanManageSeason");

        org.MapGet("/seasons/{seasonId:guid}", async (
            Guid orgId,
            Guid seasonId,
            ICurrentUser current,
            IErudozaDbContext db,
            ICompetitionScopeResolver resolver,
            CancellationToken cancellationToken) =>
        {
            if (ForbidOrg(orgId, current) is { } forbidden)
            {
                return forbidden;
            }

            var season = await db.Seasons.AsNoTracking().SingleOrDefaultAsync(
                item => item.Id == seasonId && item.OrganizationId == orgId,
                cancellationToken);
            return season is null
                ? Results.Problem(statusCode: StatusCodes.Status404NotFound, title: "Season was not found.")
                : Results.Ok(await MapSeason(db, resolver, season, cancellationToken));
        });

        org.MapGet("/students", async (Guid orgId, ICurrentUser current, IErudozaDbContext db, CancellationToken cancellationToken) =>
        {
            if (ForbidAdmin(orgId, current) is { } forbidden)
            {
                return forbidden;
            }

            var students = await db.OrganizationMembers
                .AsNoTracking()
                .Where(item => item.OrganizationId == orgId && item.Role == OrganizationRole.Student)
                .Join(db.Users, member => member.UserId, user => user.Id, (_, user) => user)
                .ToListAsync(cancellationToken);
            return Results.Ok(students.Select(DtoMapper.ToStudentDto));
        }).RequireAuthorization("CanManageStudents");

        org.MapPost("/students", async (
            Guid orgId,
            CreateStudentRequest request,
            ICurrentUser current,
            StudentDirectoryService directory,
            CancellationToken cancellationToken) =>
        {
            if (ForbidAdmin(orgId, current) is { } forbidden)
            {
                return forbidden;
            }

            var student = await directory.CreateStudentAsync(orgId, request, cancellationToken);
            return Results.Created($"/api/v1/organizations/{orgId}/students/{student.Id}", DtoMapper.ToStudentDto(student));
        }).RequireAuthorization("CanManageStudents");

        org.MapGet("/content-packs", async (Guid orgId, ICurrentUser current, IErudozaDbContext db, CancellationToken cancellationToken) =>
        {
            if (ForbidAdmin(orgId, current) is { } forbidden)
            {
                return forbidden;
            }

            var packs = await db.ContentPacks.AsNoTracking()
                .Where(item => item.OrganizationId == orgId)
                .Select(item => new ContentPackDto(
                    item.Id,
                    item.PackKey,
                    item.Version,
                    item.Locale,
                    item.SourceType.ToString(),
                    item.LicensingStatus,
                    db.SourceUnits.Count(unit => unit.ContentPackId == item.Id)))
                .ToListAsync(cancellationToken);
            return Results.Ok(packs);
        }).RequireAuthorization("CanManageContent");

        org.MapPost("/content-packs/import", async (
            Guid orgId,
            ImportContentPackRequest request,
            ICurrentUser current,
            ContentImportService importer,
            IErudozaDbContext db,
            CancellationToken cancellationToken) =>
        {
            if (ForbidAdmin(orgId, current) is { } forbidden)
            {
                return forbidden;
            }

            var pack = await importer.ImportAsync(orgId, request, cancellationToken);
            var count = await db.SourceUnits.CountAsync(item => item.ContentPackId == pack.Id, cancellationToken);
            return Results.Ok(new ContentPackDto(pack.Id, pack.PackKey, pack.Version, pack.Locale, pack.SourceType.ToString(), pack.LicensingStatus, count));
        }).RequireAuthorization("CanManageContent");

        org.MapGet("/content-packs/{contentPackId:guid}/source-units", async (
            Guid orgId,
            Guid contentPackId,
            ICurrentUser current,
            IErudozaDbContext db,
            CancellationToken cancellationToken) =>
        {
            if (ForbidAdmin(orgId, current) is { } forbidden)
            {
                return forbidden;
            }

            var units = await db.SourceUnits.AsNoTracking()
                .Where(item => item.OrganizationId == orgId && item.ContentPackId == contentPackId)
                .OrderBy(item => item.Ordinal)
                .Select(item => new SourceUnitDto(item.Id, item.CitationLabel, item.BookKey, item.Chapter, item.Verse, item.Ordinal, item.CanonicalText))
                .ToListAsync(cancellationToken);
            return Results.Ok(units);
        }).RequireAuthorization("CanManageContent");

        org.MapPost("/seasons/{seasonId:guid}/scope", async (
            Guid orgId,
            Guid seasonId,
            DefineScopeRequest request,
            ICurrentUser current,
            SeasonWorkflowService seasons,
            CancellationToken cancellationToken) =>
        {
            if (ForbidAdmin(orgId, current) is { } forbidden)
            {
                return forbidden;
            }

            await seasons.DefineScopeAsync(orgId, seasonId, request, cancellationToken);
            return Results.NoContent();
        }).RequireAuthorization("CanManageSeason");

        org.MapGet("/seasons/{seasonId:guid}/assignments", async (
            Guid orgId,
            Guid seasonId,
            ICurrentUser current,
            IErudozaDbContext db,
            CancellationToken cancellationToken) =>
        {
            if (ForbidOrg(orgId, current) is { } forbidden)
            {
                return forbidden;
            }

            var query = db.Assignments.AsNoTracking()
                .Include(item => item.Scopes)
                .Where(item => item.OrganizationId == orgId && item.SeasonId == seasonId);
            if (current.IsStudent)
            {
                query = query.Where(item => item.StudentUserId == current.UserId);
            }

            var assignments = await query.ToListAsync(cancellationToken);
            return Results.Ok(assignments.Select(DtoMapper.ToAssignmentDto));
        });

        org.MapPost("/seasons/{seasonId:guid}/assignments", async (
            Guid orgId,
            Guid seasonId,
            CreateAssignmentRequest request,
            ICurrentUser current,
            SeasonWorkflowService seasons,
            IErudozaDbContext db,
            CancellationToken cancellationToken) =>
        {
            if (ForbidAdmin(orgId, current) is { } forbidden)
            {
                return forbidden;
            }

            var assignment = await seasons.AssignAsync(orgId, seasonId, request, cancellationToken);
            assignment = await db.Assignments.Include(item => item.Scopes).SingleAsync(item => item.Id == assignment.Id, cancellationToken);
            return Results.Ok(DtoMapper.ToAssignmentDto(assignment));
        }).RequireAuthorization("CanManageSeason");

        org.MapPost("/seasons/{seasonId:guid}/activate", async (
            Guid orgId,
            Guid seasonId,
            ICurrentUser current,
            SeasonWorkflowService seasons,
            CancellationToken cancellationToken) =>
        {
            if (ForbidAdmin(orgId, current) is { } forbidden)
            {
                return forbidden;
            }

            var result = await seasons.ActivateAsync(orgId, seasonId, cancellationToken);
            return result.Activated ? Results.Ok(result) : Results.BadRequest(result);
        }).RequireAuthorization("CanManageSeason");

        var study = app.MapGroup("/api/v1/study").RequireAuthorization("CanStudy");

        study.MapPost("/sessions", async (
            StartSessionRequest request,
            ICurrentUser current,
            StudySessionService sessions,
            CancellationToken cancellationToken) =>
        {
            var session = await sessions.StartAsync(current.OrganizationId, current.UserId, request, cancellationToken);
            return Results.Ok(new SessionDto(session.Id, session.SeasonId, session.Status.ToString(), session.Mode.ToString(), session.TargetCardCount));
        });

        study.MapGet("/sessions/{sessionId:guid}/next", async (
            Guid sessionId,
            ICurrentUser current,
            StudySessionService sessions,
            IErudozaDbContext db,
            IConfiguration configuration,
            CancellationToken cancellationToken) =>
        {
            var card = await sessions.NextAsync(
                new StudyContext(current.OrganizationId, current.UserId, await SeasonForSession(db, sessionId, current, cancellationToken), sessionId, StudyMode.Practice),
                cancellationToken);
            var source = await db.SourceUnits.SingleAsync(item => item.Id == card.SourceUnitId, cancellationToken);
            var session = await db.StudySessions.SingleAsync(item => item.Id == sessionId, cancellationToken);
            return Results.Ok(DtoMapper.ToChallengeCardDto(card, source, session.TargetCardCount, ExposeDebug(configuration)));
        });

        study.MapPost("/sessions/{sessionId:guid}/attempts", async (
            Guid sessionId,
            SubmitAttemptRequest request,
            ICurrentUser current,
            StudySessionService sessions,
            IConfiguration configuration,
            CancellationToken cancellationToken) =>
        {
            var result = await sessions.SubmitAsync(
                current.OrganizationId,
                current.UserId,
                sessionId,
                request,
                ExposeDebug(configuration),
                cancellationToken);
            return Results.Ok(result);
        });

        study.MapPost("/sessions/{sessionId:guid}/complete", async (
            Guid sessionId,
            ICurrentUser current,
            StudySessionService sessions,
            CancellationToken cancellationToken) =>
        {
            await sessions.CompleteAsync(current.OrganizationId, current.UserId, sessionId, cancellationToken);
            return Results.NoContent();
        });

        app.MapGet("/api/v1/progress/me", async (ICurrentUser current, IErudozaDbContext db, CancellationToken cancellationToken) =>
        {
            if (!current.IsStudent && !current.IsAdmin)
            {
                return Results.Problem(statusCode: StatusCodes.Status403Forbidden, title: "Progress is limited to the signed-in student.");
            }

            var studentId = current.UserId;
            var season = (await db.Seasons.AsNoTracking()
                .Where(item => item.OrganizationId == current.OrganizationId && item.Status == SeasonStatus.Active)
                .ToListAsync(cancellationToken))
                .OrderByDescending(item => item.ActivatedAtUtc)
                .FirstOrDefault();

            if (season is null)
            {
                return Results.Ok(new ProgressDto(Guid.Empty, string.Empty, "None", [], 0, 0, 0, []));
            }

            var assignments = await db.Assignments.AsNoTracking()
                .Include(item => item.Scopes)
                .Where(item => item.OrganizationId == current.OrganizationId && item.SeasonId == season.Id && item.StudentUserId == studentId)
                .ToListAsync(cancellationToken);
            var mastery = await db.MasteryStates.AsNoTracking()
                .Where(item => item.OrganizationId == current.OrganizationId && item.StudentUserId == studentId && item.SeasonId == season.Id)
                .ToListAsync(cancellationToken);
            var reviews = await db.ReviewSchedules.AsNoTracking()
                .Where(item => item.OrganizationId == current.OrganizationId && item.StudentUserId == studentId && item.SeasonId == season.Id)
                .ToListAsync(cancellationToken);
            var knowledge = await db.KnowledgeUnits.AsNoTracking()
                .Where(item => item.OrganizationId == current.OrganizationId)
                .ToDictionaryAsync(item => item.Id, cancellationToken);
            var attempts = await db.Attempts.CountAsync(
                item => item.OrganizationId == current.OrganizationId && item.StudentUserId == studentId && item.SeasonId == season.Id,
                cancellationToken);

            return Results.Ok(new ProgressDto(
                season.Id,
                season.Name,
                season.Status.ToString(),
                assignments.Select(DtoMapper.ToAssignmentDto).ToList(),
                mastery.Count(item => item.Level is MasteryLevel.Strong or MasteryLevel.Mastered),
                reviews.Count(item => item.DueAtUtc <= DateTimeOffset.UtcNow),
                attempts,
                mastery.Select(item => new MasteryRowDto(
                    item.KnowledgeUnitId,
                    knowledge.TryGetValue(item.KnowledgeUnitId, out var unit) ? unit.Title : "Passage",
                    item.Level.ToString(),
                    item.ExactWordingScore,
                    item.RecognitionScore,
                    reviews.FirstOrDefault(review => review.KnowledgeUnitId == item.KnowledgeUnitId)?.DueAtUtc)).ToList()));
        }).RequireAuthorization("CanViewOwnProgress");
    }

    private static bool ExposeDebug(IConfiguration configuration) =>
        configuration.GetValue("ExposeDebugAnswers", false);

    private static async Task<Guid> SeasonForSession(IErudozaDbContext db, Guid sessionId, ICurrentUser current, CancellationToken cancellationToken)
    {
        var session = await db.StudySessions.AsNoTracking().SingleAsync(
            item => item.Id == sessionId && item.OrganizationId == current.OrganizationId && item.StudentUserId == current.UserId,
            cancellationToken);
        return session.SeasonId;
    }

    private static async Task<SeasonDto> MapSeason(
        IErudozaDbContext db,
        ICompetitionScopeResolver resolver,
        CompetitionSeason season,
        CancellationToken cancellationToken)
    {
        var profile = await db.RuleProfiles.AsNoTracking().SingleAsync(item => item.Id == season.RuleProfileId, cancellationToken);
        var scopeCount = (await resolver.ResolveAsync(season.OrganizationId, season.Id, cancellationToken)).Count;
        var assignmentCount = await db.Assignments.CountAsync(item => item.SeasonId == season.Id && item.OrganizationId == season.OrganizationId, cancellationToken);
        return DtoMapper.ToSeasonDto(season, profile, scopeCount, assignmentCount);
    }

    private static MeDto ToMe(ApplicationUser user, OrganizationMember membership) =>
        new(
            user.Id,
            membership.OrganizationId,
            membership.Organization?.Name ?? "Organization",
            user.DisplayName,
            user.UserName,
            user.Email,
            user.Kind.ToString(),
            membership.Role.ToString());

    private static IResult? ForbidOrg(Guid orgId, ICurrentUser current) =>
        orgId == current.OrganizationId
            ? null
            : Results.Problem(statusCode: StatusCodes.Status403Forbidden, title: "Organization access denied.");

    private static IResult? ForbidAdmin(Guid orgId, ICurrentUser current) =>
        orgId == current.OrganizationId && current.IsAdmin
            ? null
            : Results.Problem(statusCode: StatusCodes.Status403Forbidden, title: "Administrator access denied.");
}
