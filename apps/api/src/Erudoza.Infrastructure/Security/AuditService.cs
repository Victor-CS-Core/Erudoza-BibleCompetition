using System.Text.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Domain;

namespace Erudoza.Infrastructure.Security;

public sealed class AuditService(
    IErudozaDbContext db,
    ICurrentUser currentUser,
    IClock clock,
    ICorrelationIdAccessor correlation) : IAuditService
{
    public async Task RecordAsync(
        string action,
        string entityType,
        Guid? entityId,
        object? metadata = null,
        CancellationToken cancellationToken = default)
    {
        db.AuditEvents.Add(new AuditEvent
        {
            Id = Guid.NewGuid(),
            OrganizationId = currentUser.IsAuthenticated ? currentUser.OrganizationId : Guid.Empty,
            ActorUserId = currentUser.IsAuthenticated ? currentUser.UserId : null,
            Action = action,
            EntityType = entityType,
            EntityId = entityId,
            CorrelationId = correlation.CorrelationId,
            MetadataJson = metadata is null ? "{}" : JsonSerializer.Serialize(metadata),
            CreatedAtUtc = clock.UtcNow
        });
        await db.SaveChangesAsync(cancellationToken);
    }
}
