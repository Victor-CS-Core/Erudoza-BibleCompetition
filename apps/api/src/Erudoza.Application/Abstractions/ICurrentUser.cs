using Erudoza.Domain;

namespace Erudoza.Application.Abstractions;

public interface ICurrentUser
{
    bool IsAuthenticated { get; }
    Guid UserId { get; }
    Guid OrganizationId { get; }
    UserKind Kind { get; }
    OrganizationRole Role { get; }
    string DisplayName { get; }
    bool IsAdmin { get; }
    bool IsStudent { get; }
}

public interface IPasswordHasher
{
    string Hash(string password);
    bool Verify(string hash, string password);
}

public interface IClock
{
    DateTimeOffset UtcNow { get; }
}

public sealed class SystemClock : IClock
{
    public DateTimeOffset UtcNow => DateTimeOffset.UtcNow;
}

public interface IAuditService
{
    Task RecordAsync(
        string action,
        string entityType,
        Guid? entityId,
        object? metadata = null,
        CancellationToken cancellationToken = default);
}

public interface IBlobStorage
{
    string ProviderName { get; }
    Task<bool> IsHealthyAsync(CancellationToken cancellationToken);
}

public interface ICorrelationIdAccessor
{
    string? CorrelationId { get; }
}
