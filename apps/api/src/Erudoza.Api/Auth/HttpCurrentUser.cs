using System.Security.Claims;
using Erudoza.Application.Abstractions;
using Erudoza.Domain;

namespace Erudoza.Api.Auth;

public sealed class HttpCurrentUser(IHttpContextAccessor accessor) : ICurrentUser
{
    public bool IsAuthenticated => accessor.HttpContext?.User.Identity?.IsAuthenticated == true;

    public Guid UserId => Guid.Parse(Require("sub"));

    public Guid OrganizationId => Guid.Parse(Require("org"));

    public UserKind Kind => Enum.Parse<UserKind>(Require("kind"));

    public OrganizationRole Role => Enum.Parse<OrganizationRole>(Require(ClaimTypes.Role));

    public string DisplayName => Require("name");

    public bool IsAdmin => Role is OrganizationRole.Admin or OrganizationRole.Owner;

    public bool IsStudent => Kind == UserKind.Student && Role == OrganizationRole.Student;

    private string Require(string claim)
    {
        return accessor.HttpContext?.User.FindFirstValue(claim)
            ?? throw new InvalidOperationException($"Authenticated user is missing the '{claim}' claim.");
    }
}

public sealed class HttpCorrelationIdAccessor(IHttpContextAccessor accessor) : ICorrelationIdAccessor
{
    public string? CorrelationId => accessor.HttpContext?.Items[CorrelationMiddleware.ItemKey] as string;
}
