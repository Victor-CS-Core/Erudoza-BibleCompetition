using Erudoza.Application.Abstractions;
using Erudoza.Application.Contracts;
using Erudoza.Domain;
using Microsoft.EntityFrameworkCore;

namespace Erudoza.Application.Identity;

public sealed class StudentDirectoryService(
    IErudozaDbContext db,
    IPasswordHasher passwords,
    IClock clock,
    IAuditService audit)
{
    public async Task<ApplicationUser> CreateStudentAsync(
        Guid organizationId,
        CreateStudentRequest request,
        CancellationToken cancellationToken)
    {
        var userName = request.UserName.Trim().ToLowerInvariant();
        if (await db.Users.AnyAsync(item => item.UserName == userName, cancellationToken))
        {
            throw new DomainException("That username is already in use.");
        }

        var user = new ApplicationUser
        {
            Id = Guid.NewGuid(),
            UserName = userName,
            Email = null,
            PasswordHash = passwords.Hash(request.Password),
            DisplayName = request.DisplayName.Trim(),
            Kind = UserKind.Student,
            CreatedAtUtc = clock.UtcNow
        };
        db.Users.Add(user);
        db.StudentProfiles.Add(new StudentProfile
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            OrganizationId = organizationId,
            DisplayName = user.DisplayName,
            CreatedAtUtc = clock.UtcNow
        });
        db.OrganizationMembers.Add(new OrganizationMember
        {
            Id = Guid.NewGuid(),
            OrganizationId = organizationId,
            UserId = user.Id,
            Role = OrganizationRole.Student,
            CreatedAtUtc = clock.UtcNow
        });
        await db.SaveChangesAsync(cancellationToken);
        await audit.RecordAsync("student.create", nameof(ApplicationUser), user.Id, new { user.UserName }, cancellationToken);
        return user;
    }
}
