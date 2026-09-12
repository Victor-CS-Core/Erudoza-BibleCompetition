using System.Text.Json;
using Erudoza.Application.Study;
using Erudoza.Domain;
using Microsoft.EntityFrameworkCore;

namespace Erudoza.Api.Practice;

public sealed partial class PracticeService
{
    // This outbox commits with the authoritative room, before projection. A projection failure
    // cannot roll back a locked answer or change its original clock evidence.
    private async Task QueueRoomExposure(Guid org, PracticeRoom room, CancellationToken ct)
    {
        if (!IsPbe(room) || room.Services.Count == 0) return;
        var id = room.Id.ToString();
        var row = await db.PbeTrainingRecords.SingleOrDefaultAsync(r => r.OrganizationId == org && r.Kind == "pbe-room-service-outbox" && r.Id == id, ct);
        if (row is null) { row = new() { OrganizationId = org, SeasonId = room.SeasonId, Kind = "pbe-room-service-outbox", Id = id }; db.Add(row); }
        row.DataJson = JsonSerializer.Serialize(room.Services, PbeQuestionBank.Json); row.Revision++;
    }
    private async Task ProjectRoomExposure(Guid org, Guid roomId, CancellationToken ct)
    {
        try
        {
            await using var transaction = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, ct);
            var id = roomId.ToString();
            var outbox = await db.PbeTrainingRecords.SingleOrDefaultAsync(r => r.OrganizationId == org && r.Kind == "pbe-room-service-outbox" && r.Id == id, ct);
            if (outbox is null) return;
            var events = JsonSerializer.Deserialize<List<PbeRoomService>>(outbox.DataJson, PbeQuestionBank.Json)!;
            var eventIds = events.Select(e => e.Id.ToString()).ToArray();
            var recorded = await db.PbeTrainingRecords.Where(r => r.OrganizationId == org && r.Kind == "pbe-room-service-event" && eventIds.Contains(r.Id)).Select(r => r.Id).ToListAsync(ct);
            events = events.Where(e => !recorded.Contains(e.Id.ToString())).ToList();
            var changes = events.SelectMany(e => e.MemberIds.SelectMany(user => e.TargetIds.Select(target => (Kind: "pbe-target-service", User: user, Subject: target, Event: e)).Append((Kind: "pbe-question-service", User: user, Subject: e.QuestionId, Event: e)))).ToList();
            string Key(Guid user, Guid subject) => $"{user}:{outbox.SeasonId}:{subject}";
            var projectionIds = changes.Select(c => Key(c.User, c.Subject)).Distinct().ToArray();
            var rows = await db.PbeTrainingRecords.Where(r => r.OrganizationId == org && r.SeasonId == outbox.SeasonId && (r.Kind == "pbe-question-service" || r.Kind == "pbe-target-service") && projectionIds.Contains(r.Id)).ToListAsync(ct);
            foreach (var group in changes.GroupBy(c => (c.Kind, c.User, c.Subject)))
            {
                var key = Key(group.Key.User, group.Key.Subject);
                var row = rows.SingleOrDefault(r => r.Kind == group.Key.Kind && r.Id == key);
                var prior = row is null ? null : JsonSerializer.Deserialize<PbeServiceProjection>(row.DataJson, PbeQuestionBank.Json);
                var last = group.MaxBy(c => c.Event.AtMs).Event;
                var value = new PbeServiceProjection(key, group.Key.Subject, (prior?.ServedCount ?? 0) + group.Count(), Math.Max(prior?.LastServedAtMs ?? 0, last.AtMs), prior is not null && prior.LastServedAtMs > last.AtMs ? prior.LastQuestionId : last.QuestionId, prior is not null && prior.LastServedAtMs > last.AtMs ? prior.LastQuestionKind : last.QuestionKind);
                if (row is null) { row = new() { OrganizationId = org, SeasonId = outbox.SeasonId, OwnerId = group.Key.User, Kind = group.Key.Kind, Id = key }; db.Add(row); }
                row.DataJson = JsonSerializer.Serialize(value, PbeQuestionBank.Json); row.Revision++;
            }
            foreach (var e in events) db.PbeTrainingRecords.Add(new() { OrganizationId = org, SeasonId = outbox.SeasonId, Kind = "pbe-room-service-event", Id = e.Id.ToString(), DataJson = JsonSerializer.Serialize(e, PbeQuestionBank.Json) });
            db.Remove(outbox); await db.SaveChangesAsync(ct); await transaction.CommitAsync(ct);
        }
        catch (DbUpdateException)
        {
            // The committed outbox remains retryable by the ticker or a room read.
            foreach (var entry in db.ChangeTracker.Entries<PbeTrainingRecord>().ToList()) entry.State = EntityState.Detached;
        }
    }
}
