using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Erudoza.Application.Abstractions;
using Erudoza.Domain;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.EntityFrameworkCore;

namespace Erudoza.Api.Auth;

public static class SessionValidation
{
    public static string Fingerprint(ApplicationUser user) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(user.PasswordHash + ":" + user.SecurityStamp)));

    public static async Task ValidateAsync(CookieValidatePrincipalContext context)
    {
        var principal = context.Principal;
        var db = context.HttpContext.RequestServices.GetRequiredService<IErudozaDbContext>();
        var token = context.HttpContext.RequestAborted;
        if (Guid.TryParse(principal?.FindFirstValue("sub"), out var userId)
            && Guid.TryParse(principal?.FindFirstValue("org"), out var orgId))
        {
            var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(x => x.Id == userId, token);
            var member = await db.OrganizationMembers.AsNoTracking()
                .SingleOrDefaultAsync(x => x.UserId == userId && x.OrganizationId == orgId, token);
            if (user is { IsActive: true } && member is not null
                && principal!.FindFirstValue("credential_version") == Fingerprint(user)
                && principal.FindFirstValue(ClaimTypes.Role) == member.Role.ToString()
                && principal.FindFirstValue("kind") == user.Kind.ToString()) return;
        }
        context.RejectPrincipal();
        await context.HttpContext.SignOutAsync(context.Scheme.Name);
    }
}
