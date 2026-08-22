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

    public async Task ResetPasswordAsync(
        Guid organizationId,
        Guid studentId,
        ResetStudentPasswordRequest request,
        CancellationToken cancellationToken)
    {
        EnsurePassword(request.Password);
        var membership = await db.OrganizationMembers.SingleOrDefaultAsync(
            item => item.OrganizationId == organizationId
                && item.UserId == studentId
                && item.Role == OrganizationRole.Student,
            cancellationToken);
        if (membership is null)
        {
            throw new DomainException("Student was not found in this organization.");
        }

        var user = await db.Users.SingleAsync(item => item.Id == studentId, cancellationToken);
        if (user.Kind != UserKind.Student)
        {
            throw new DomainException("Only student credentials can be reset.");
        }

        user.PasswordHash = passwords.Hash(request.Password);
        await db.SaveChangesAsync(cancellationToken);
        await audit.RecordAsync("student.password.reset", nameof(ApplicationUser), user.Id, new { user.UserName }, cancellationToken);
    }

    private static void EnsurePassword(string password)
    {
        if (string.IsNullOrWhiteSpace(password) || password.Trim().Length < 8)
        {
            throw new DomainException("Student passwords must be at least 8 characters.");
        }
    }
}
