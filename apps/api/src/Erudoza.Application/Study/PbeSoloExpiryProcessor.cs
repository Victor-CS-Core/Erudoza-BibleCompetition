using Erudoza.Application.Abstractions;
using Erudoza.Application.Contracts;
using Erudoza.Domain;
using Microsoft.EntityFrameworkCore;

namespace Erudoza.Application.Study;

public sealed class PbeSoloExpiryProcessor(IErudozaDbContext db, IClock clock, ICompetitionScopeResolver competition, IStudentStudyScopeService assignments, IPbeQuestionBank bank, PbeProgressService progress, PbeEffortService effort, IPbeSoloTimingAuthority timing)
{
    public async Task<string?> RunOnceAsync(string? afterId, CancellationToken ct = default)
    {
        var query = db.PbeTrainingRecords.AsNoTracking().Where(record => record.Kind == "pbe-solo-outbox" && record.OwnerId != null);
        if (afterId is not null) query = query.Where(record => string.Compare(record.Id, afterId) > 0);
        var rows = await query.OrderBy(record => record.Id).Take(32).Select(record => new { record.Id, record.OrganizationId, record.OwnerId }).ToListAsync(ct);
        if (rows.Count == 0 && afterId is not null) return await RunOnceAsync(null, ct);
        foreach (var row in rows)
        {
            try
            {
                var current = new SavedCurrentUser(row.OrganizationId, row.OwnerId!.Value);
                var resolver = new PbeSourceResolver(db, current, competition, assignments);
                var service = new PbeSessionService(db, current, clock, resolver, bank, progress, effort, timing);
                await service.TimedStatusAsync(Guid.Parse(row.Id), null, ct);
            }
            catch (PbeProgressConflictException) { }
            catch (KeyNotFoundException) { }
            catch (UnauthorizedAccessException) { }
            catch (DomainException) { }
            catch (FormatException) { }
        }
        return rows.Count == 0 ? null : rows[^1].Id;
    }

    private sealed class SavedCurrentUser(Guid organizationId, Guid userId) : ICurrentUser
    {
        public bool IsAuthenticated => true;
        public Guid UserId { get; } = userId;
        public Guid OrganizationId { get; } = organizationId;
        public UserKind Kind => UserKind.Student;
        public OrganizationRole Role => OrganizationRole.Student;
        public string DisplayName => "Timed rehearsal";
        public bool IsAdmin => false;
        public bool IsStudent => true;
    }
}
