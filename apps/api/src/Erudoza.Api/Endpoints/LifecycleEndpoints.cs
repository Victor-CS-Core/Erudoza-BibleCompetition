using Erudoza.Application.Abstractions;
using Erudoza.Application.Competitions;
using Erudoza.Application.Contracts;
using Erudoza.Domain;
using Microsoft.EntityFrameworkCore;

namespace Erudoza.Api.Endpoints;

public static class LifecycleEndpoints
{
    public sealed record StudentStateRequest(bool IsActive);

    public static void MapLifecycleEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/v1/organizations/{orgId:guid}").RequireAuthorization("CanManageSeason");
        group.MapDelete("/seasons/{seasonId:guid}/assignments/{assignmentId:guid}", async
            (Guid orgId, Guid seasonId, Guid assignmentId, ICurrentUser current, SeasonWorkflowService workflow, CancellationToken ct) =>
        {
            if (!Allowed(orgId, current)) return Results.Forbid();
            await workflow.RemoveAssignmentAsync(orgId, seasonId, assignmentId, ct);
            return Results.NoContent();
        });
        group.MapPut("/seasons/{seasonId:guid}/assignments/{assignmentId:guid}/passage", async
            (Guid orgId, Guid seasonId, Guid assignmentId, ScopeRangeDto request, ICurrentUser current, SeasonWorkflowService workflow, CancellationToken ct) =>
        {
            if (!Allowed(orgId, current)) return Results.Forbid();
            await workflow.CorrectAssignmentAsync(orgId, seasonId, assignmentId, request, ct);
            return Results.NoContent();
        });
        foreach (var (action, status) in new[] { ("close", SeasonStatus.Completed), ("archive", SeasonStatus.Archived) })
            group.MapPost($"/seasons/{{seasonId:guid}}/{action}", async
                (Guid orgId, Guid seasonId, ICurrentUser current, SeasonWorkflowService workflow, CancellationToken ct) =>
            {
                if (!Allowed(orgId, current)) return Results.Forbid();
                await workflow.TransitionAsync(orgId, seasonId, status, ct);
                return Results.NoContent();
            });
        group.MapPut("/students/{studentId:guid}/state", async
            (Guid orgId, Guid studentId, StudentStateRequest request, ICurrentUser current, IErudozaDbContext db, IAuditService audit, CancellationToken ct) =>
        {
            if (!Allowed(orgId, current)) return Results.Forbid();
            var user = await db.Users.SingleOrDefaultAsync(item => item.Id == studentId && item.Kind == UserKind.Student
                && db.OrganizationMembers.Any(member => member.OrganizationId == orgId && member.UserId == item.Id
                    && member.Role == OrganizationRole.Student), ct)
                ?? throw new DomainException("Student was not found in this organization.");
            if (user.IsActive != request.IsActive) user.SecurityStamp = Guid.NewGuid().ToString("N");
            user.IsActive = request.IsActive;
            await db.SaveChangesAsync(ct);
            await audit.RecordAsync(request.IsActive ? "student.reactivate" : "student.deactivate", nameof(ApplicationUser), studentId, null, ct);
            return Results.NoContent();
        });
    }

    private static bool Allowed(Guid orgId, ICurrentUser current) => current.IsAdmin && current.OrganizationId == orgId;
}
