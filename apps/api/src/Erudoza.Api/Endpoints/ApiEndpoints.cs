using System.Security.Claims;
using Erudoza.Application.Abstractions;
using Erudoza.Application.Competitions;
using Erudoza.Application.Content;
using Erudoza.Application.Contracts;
using Erudoza.Application.Identity;
using Erudoza.Application.Mapping;
using Erudoza.Application.Progress;
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
                new("credential_version", Erudoza.Api.Auth.SessionValidation.Fingerprint(user)),
                new("org", membership.OrganizationId.ToString()),
                new("kind", user.Kind.ToString()),
                new(ClaimTypes.Role, membership.Role.ToString()),
                new("name", user.DisplayName),
                new("username", user.UserName)
            };
            var identity = new ClaimsIdentity(claims, CookieScheme);
            await http.SignInAsync(CookieScheme, new ClaimsPrincipal(identity));
            return Results.Ok(ToMe(user, membership));
        }).AllowAnonymous().RequireRateLimiting("login");

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

            var seasons = (await db.Seasons.AsNoTracking()
                .Where(item => item.OrganizationId == orgId)
                .ToListAsync(cancellationToken))
                .OrderByDescending(item => item.CreatedAtUtc)
                .ToList();
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

        org.MapPost("/students/{studentId:guid}/password", async (
            Guid orgId,
            Guid studentId,
            ResetStudentPasswordRequest request,
            ICurrentUser current,
            StudentDirectoryService directory,
            CancellationToken cancellationToken) =>
        {
            if (ForbidAdmin(orgId, current) is { } forbidden)
            {
                return forbidden;
            }

            await directory.ResetPasswordAsync(orgId, studentId, request, cancellationToken);
            return Results.NoContent();
        }).RequireAuthorization("CanManageStudents");

        org.MapGet("/content-packs", async (Guid orgId, ICurrentUser current, IErudozaDbContext db, CancellationToken cancellationToken) =>
        {
            if (ForbidAdmin(orgId, current) is { } forbidden)
            {
                return forbidden;
            }

            var packs = await db.ContentPacks.AsNoTracking()
                .Where(item => item.OrganizationId == orgId || item.OrganizationId == BuiltInLibrary.OrganizationId && item.IsBuiltIn)
                .Select(item => new ContentPackDto(
                    item.Id,
                    item.PackKey,
                    item.Version,
                    item.Locale,
                    item.SourceType.ToString(),
                    item.LicensingStatus,
                    db.SourceUnits.Count(unit => unit.ContentPackId == item.Id), item.IsBuiltIn))
                .ToListAsync(cancellationToken);
            return Results.Ok(packs);
        }).RequireAuthorization("CanManageContent");

        org.MapDelete("/content-packs/{contentPackId:guid}", async (
            Guid orgId, Guid contentPackId, ICurrentUser current, IErudozaDbContext db, CancellationToken cancellationToken) =>
        {
            if (ForbidAdmin(orgId, current) is { } forbidden) return forbidden;
            await using var transaction = await ((DbContext)db).Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, cancellationToken);
            var pack = await db.ContentPacks.SingleOrDefaultAsync(item => item.Id == contentPackId && item.OrganizationId == orgId, cancellationToken);
            if (pack is null) return Results.NotFound();
            if (pack.IsBuiltIn || pack.OrganizationId == BuiltInLibrary.OrganizationId) return Results.Problem(statusCode: 409, title: "Built-in library books cannot be changed.");
            if (await db.ScopeEntries.AnyAsync(item => item.ContentPackId == contentPackId, cancellationToken)
                || await db.AssignmentScopes.AnyAsync(item => item.ContentPackId == contentPackId, cancellationToken))
                return Results.Problem(statusCode: 409, title: "Content pack is in use", detail: "This pack is used by a season or student assignment and cannot be deleted. Keep it to preserve their study material.");
            var knowledgeIds = db.KnowledgeUnits.Where(item => item.ContentPackId == contentPackId).Select(item => item.Id);
            var sourceIds = db.SourceUnits.Where(item => item.ContentPackId == contentPackId).Select(item => item.Id);
            if (await db.ChallengeCards.AnyAsync(item => knowledgeIds.Contains(item.KnowledgeUnitId) || sourceIds.Contains(item.SourceUnitId) || (item.AnswerSourceUnitId.HasValue && sourceIds.Contains(item.AnswerSourceUnitId.Value)), cancellationToken)
                || await db.Attempts.AnyAsync(item => knowledgeIds.Contains(item.KnowledgeUnitId), cancellationToken)
                || await db.MasteryStates.AnyAsync(item => knowledgeIds.Contains(item.KnowledgeUnitId), cancellationToken)
                || await db.ReviewSchedules.AnyAsync(item => knowledgeIds.Contains(item.KnowledgeUnitId), cancellationToken))
                return Results.Problem(statusCode: 409, title: "Content pack has study history", detail: "This pack has saved training activity and cannot be deleted.");
            db.ContentPacks.Remove(pack);
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return Results.NoContent();
        }).RequireAuthorization("CanManageContent");

        org.MapGet("/library", async (Guid orgId, ICurrentUser current, LibraryReadService library, CancellationToken ct) =>
        {
            if (ForbidAdmin(orgId, current) is { } forbidden) return forbidden;
            var installed = await library.GetAsync(ct);
            return installed is null ? Results.Problem(statusCode: 503, title: "The built-in NKJV library is not installed.") : Results.Ok(installed);
        }).RequireAuthorization("CanManageContent");

        foreach (var retired in new[] { "/content-packs/import", "/content-packs/import-from-catalog" })
            org.MapPost(retired, (Guid orgId, ICurrentUser current) =>
                ForbidAdmin(orgId, current) ?? Results.Problem(statusCode: 410, title: "Imports have been retired. Use the built-in NKJV library."))
                .RequireAuthorization("CanManageContent");
        foreach (var retired in new[] { "/scripture-catalog", "/scripture-catalog/books", "/scripture-catalog/books/{bookKey}/chapters" })
            org.MapGet(retired, (Guid orgId, ICurrentUser current) =>
                ForbidAdmin(orgId, current) ?? Results.Problem(statusCode: 410, title: "Use the built-in NKJV library."))
                .RequireAuthorization("CanManageContent");

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
                .Where(item => item.ContentPackId == contentPackId && (item.OrganizationId == orgId && item.ContentPack!.OrganizationId == orgId
                    || item.OrganizationId == BuiltInLibrary.OrganizationId && item.ContentPack!.OrganizationId == BuiltInLibrary.OrganizationId && item.ContentPack.IsBuiltIn))
                .OrderBy(item => item.Ordinal)
                .Select(item => new SourceUnitDto(item.Id, item.CitationLabel, item.BookKey, item.Chapter, item.Verse, item.Ordinal, item.CanonicalText))
                .ToListAsync(cancellationToken);
            return Results.Ok(units);
        }).RequireAuthorization("CanManageContent");

        org.MapGet("/seasons/{seasonId:guid}/scope", async (
            Guid orgId,
            Guid seasonId,
            ICurrentUser current,
            SeasonWorkflowService seasons,
            CancellationToken cancellationToken) =>
        {
            if (ForbidAdmin(orgId, current) is { } forbidden) return forbidden;
            return Results.Ok(await seasons.GetScopeAsync(orgId, seasonId, cancellationToken));
        }).RequireAuthorization("CanManageSeason");

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
            if (assignments.Count == 0)
            {
                return Results.Ok(Array.Empty<AssignmentDto>());
            }

            var userIds = assignments.Select(item => item.StudentUserId).Distinct().ToList();
            var users = await db.Users.AsNoTracking()
                .Where(item => userIds.Contains(item.Id))
                .ToListAsync(cancellationToken);
            var byId = users.ToDictionary(item => item.Id);
            var difficulties = await db.CompetitionMembers.AsNoTracking()
                .Where(item => item.OrganizationId == orgId && item.SeasonId == seasonId)
                .ToDictionaryAsync(item => item.UserId, item => item.Difficulty, cancellationToken);
            return Results.Ok(assignments.Select(item =>
                DtoMapper.ToAssignmentDto(item, byId.GetValueOrDefault(item.StudentUserId),
                    difficulties.GetValueOrDefault(item.StudentUserId, TrainingDifficulty.Standard))));
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
            var difficulty = await db.CompetitionMembers.Where(item => item.OrganizationId == orgId
                && item.SeasonId == seasonId && item.UserId == assignment.StudentUserId)
                .Select(item => item.Difficulty).SingleAsync(cancellationToken);
            return Results.Ok(DtoMapper.ToAssignmentDto(assignment, difficulty: difficulty));
        }).RequireAuthorization("CanManageSeason");

        org.MapPut("/seasons/{seasonId:guid}/students/{studentId:guid}/difficulty", async (
            Guid orgId, Guid seasonId, Guid studentId, SetStudentDifficultyRequest request,
            ICurrentUser current, SeasonWorkflowService seasons, CancellationToken cancellationToken) =>
        {
            if (ForbidAdmin(orgId, current) is { } forbidden) return forbidden;
            await seasons.SetDifficultyAsync(orgId, seasonId, studentId, request.Difficulty, cancellationToken);
            return Results.Ok(new { difficulty = request.Difficulty.ToString() });
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

        org.MapGet("/seasons/{seasonId:guid}/coverage", async (
            Guid orgId,
            Guid seasonId,
            ICurrentUser current,
            SeasonCoverageService coverage,
            CancellationToken cancellationToken) =>
        {
            if (ForbidAdmin(orgId, current) is { } forbidden)
            {
                return forbidden;
            }

            return Results.Ok(await coverage.GetAsync(orgId, seasonId, cancellationToken));
        }).RequireAuthorization("CanManageSeason");

        var study = app.MapGroup("/api/v1/study").RequireAuthorization("CanStudy");
        study.AddEndpointFilter(async (context, next) =>
        {
            try { return await next(context); }
            catch (PbeSessionUnavailableException error) { return Results.Conflict(new { code = error.Code, message = error.Message, format = "Pbe" }); }
            catch (PbeProgressConflictException error) { return Results.Conflict(new { message = error.Message }); }
            catch (KeyNotFoundException error) { return Results.NotFound(new { message = error.Message }); }
            catch (UnauthorizedAccessException) { return Results.Forbid(); }
            catch (Microsoft.Data.Sqlite.SqliteException error) when (error.SqliteErrorCode is 5 or 6) { return Results.Conflict(new { message = "The PBE record changed. Refresh and retry." }); }
        });

        study.MapGet("/sessions/{sessionId:guid}", async (Guid sessionId, ICurrentUser current,
            StudySessionService sessions, PbeSessionService pbe, IConfiguration configuration, CancellationToken cancellationToken) =>
            await pbe.ExistsAsync(sessionId, cancellationToken) ? Results.Ok(await pbe.ActionAsync(sessionId, null, null, cancellationToken)) : Results.Ok(await sessions.ResumeAsync(current.OrganizationId, current.UserId, sessionId,
                ExposeDebug(configuration, app.Environment), cancellationToken)));

        study.MapPost("/sessions", async (
            System.Text.Json.JsonElement payload,
            ICurrentUser current,
            StudySessionService sessions, PbeSessionService pbe,
            CancellationToken cancellationToken) =>
        {
            if (payload.ValueKind != System.Text.Json.JsonValueKind.Object) throw new DomainException("Provide a study request.");
            if (payload.TryGetProperty("format", out var format) && (format.ValueKind != System.Text.Json.JsonValueKind.String || format.GetString() is not ("Memory" or "Pbe"))) throw new DomainException("Choose Memory or Pbe.");
            StartSessionRequest request;
            try { request = System.Text.Json.JsonSerializer.Deserialize<StartSessionRequest>(payload.GetRawText(), PbeQuestionBank.Json) ?? throw new System.Text.Json.JsonException(); }
            catch (System.Text.Json.JsonException) { throw new DomainException("Choose a valid format, mode and session scope."); }
            if (request.Format == "Pbe") return Results.Ok(await pbe.StartAsync(request, cancellationToken));
            if (request.Format is not (null or "Memory")) throw new DomainException("Choose Memory or Pbe.");
            var session = await sessions.StartAsync(current.OrganizationId, current.UserId, request, cancellationToken);
            return Results.Ok(new SessionDto(session.Id, session.SeasonId, session.Status.ToString(), session.Mode.ToString(), session.TargetCardCount, session.Difficulty.ToString()));
        });

        study.MapGet("/sessions/{sessionId:guid}/next", async (
            Guid sessionId,
            ICurrentUser current,
            StudySessionService sessions, PbeSessionService pbe,
            IErudozaDbContext db,
            IConfiguration configuration,
            CancellationToken cancellationToken) =>
        {
            if (await pbe.ExistsAsync(sessionId, cancellationToken)) return Results.Ok(await pbe.ActionAsync(sessionId, "next", null, cancellationToken));
            var session = await db.StudySessions.AsNoTracking().SingleAsync(
                item => item.Id == sessionId
                    && item.OrganizationId == current.OrganizationId
                    && item.StudentUserId == current.UserId,
                cancellationToken);
            var season = await db.Seasons.AsNoTracking().Include(item => item.RuleProfile)
                .SingleAsync(item => item.Id == session.SeasonId && item.OrganizationId == current.OrganizationId, cancellationToken);
            var snapshot = RuleProfileReader.ReadSession(session, season.RuleProfile!);
            var card = await sessions.NextAsync(
                new StudyContext(current.OrganizationId, current.UserId, session.SeasonId, sessionId, session.Mode),
                cancellationToken);
            var source = await db.SourceUnits.SingleAsync(item => item.Id == card.SourceUnitId, cancellationToken);
            var showCitation = session.Mode != StudyMode.Simulation || snapshot.ShowReference;
            return Results.Ok(DtoMapper.ToChallengeCardDto(card, source, session.TargetCardCount, ExposeDebug(configuration, app.Environment), showCitation));
        });

        study.MapPost("/sessions/{sessionId:guid}/attempts", async (
            Guid sessionId,
            System.Text.Json.JsonElement request,
            ICurrentUser current,
            StudySessionService sessions, PbeSessionService pbe,
            IConfiguration configuration,
            CancellationToken cancellationToken) =>
        {
            if (await pbe.ExistsAsync(sessionId, cancellationToken)) return Results.Ok(await pbe.ActionAsync(sessionId, "attempts", request, cancellationToken));
            var legacy = System.Text.Json.JsonSerializer.Deserialize<SubmitAttemptRequest>(request.GetRawText(), new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web)) ?? throw new DomainException("Provide an answer.");
            var result = await sessions.SubmitAsync(
                current.OrganizationId,
                current.UserId,
                sessionId,
                legacy,
                ExposeDebug(configuration, app.Environment),
                cancellationToken);
            return Results.Ok(result);
        });

        study.MapPost("/sessions/{sessionId:guid}/complete", async (
            Guid sessionId,
            ICurrentUser current,
            StudySessionService sessions, PbeSessionService pbe,
            CancellationToken cancellationToken) =>
        {
            if (await pbe.ExistsAsync(sessionId, cancellationToken)) return Results.Ok(await pbe.ActionAsync(sessionId, "complete", null, cancellationToken));
            var summary = await sessions.CompleteAsync(current.OrganizationId, current.UserId, sessionId, cancellationToken);
            return Results.Ok(summary);
        });

        study.MapPost("/sessions/{sessionId:guid}/source", async (Guid sessionId, System.Text.Json.JsonElement request, PbeSessionService pbe, CancellationToken ct) => Results.Ok(await pbe.ActionAsync(sessionId, "source", request, ct)));

        app.MapGet("/api/v1/progress/me/seasons", async (ICurrentUser current, IErudozaDbContext db, PbeSourceResolver pbeSources, CancellationToken cancellationToken) =>
        {
            var assigned = await db.Seasons.AsNoTracking().Where(item => item.OrganizationId == current.OrganizationId
                && item.Status == SeasonStatus.Active && (db.Assignments.Any(assignment => assignment.SeasonId == item.Id
                    && assignment.OrganizationId == current.OrganizationId && assignment.StudentUserId == current.UserId) || item.PbeEnabled && db.PbeTrainingRecords.Any(r => r.OrganizationId == current.OrganizationId && r.SeasonId == item.Id && r.OwnerId == current.UserId && r.Kind == "pbe-introduction-assignment")))
                .Select(item => new { item.Id, item.Name, HasMemory = db.Assignments.Any(a => a.OrganizationId == current.OrganizationId && a.SeasonId == item.Id && a.StudentUserId == current.UserId) }).ToListAsync(cancellationToken);
            var visible = new List<object>();
            foreach (var season in assigned)
            {
                if (season.HasMemory || (await pbeSources.ResolveAsync(current.OrganizationId, season.Id, current.UserId, cancellationToken)).Sources.Count > 0) visible.Add(new { season.Id, season.Name });
            }
            return Results.Ok(visible);
        }).RequireAuthorization("CanStudy");

        app.MapGet("/api/v1/progress/me", async (Guid? seasonId, ICurrentUser current, ProgressQueryService progress, CancellationToken cancellationToken) =>
        {
            if (!current.IsStudent && !current.IsAdmin)
            {
                return Results.Problem(statusCode: StatusCodes.Status403Forbidden, title: "Progress is limited to the signed-in student.");
            }

            return Results.Ok(await progress.GetAsync(current.OrganizationId, current.UserId, seasonId, cancellationToken));
        }).RequireAuthorization("CanViewOwnProgress");

        org.MapGet("/seasons/{seasonId:guid}/students/{studentId:guid}/progress", async (
            Guid orgId,
            Guid seasonId,
            Guid studentId,
            ICurrentUser current,
            ProgressQueryService progress,
            CancellationToken cancellationToken) =>
        {
            if (ForbidAdmin(orgId, current) is { } forbidden)
            {
                return forbidden;
            }

            return Results.Ok(await progress.GetAsync(orgId, studentId, seasonId, cancellationToken));
        }).RequireAuthorization("CanManageSeason");
    }

    private static bool ExposeDebug(IConfiguration configuration, IHostEnvironment environment) =>
        (environment.IsDevelopment() || environment.IsEnvironment("Testing")) && configuration.GetValue("ExposeDebugAnswers", false);

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
