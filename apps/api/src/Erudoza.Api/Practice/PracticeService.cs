using Erudoza.Domain;
using Erudoza.Domain.Practice;
using Erudoza.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Erudoza.Api.Practice;

public sealed partial class PracticeService(ErudozaDbContext db, PracticeRuntime runtime, IConfiguration configuration)
{
    private DbSet<PracticeRoomRecord> Rooms => db.Set<PracticeRoomRecord>();
    private DbSet<PracticeQuestionRecord> Questions => db.Set<PracticeQuestionRecord>();
    public async Task Check(PracticeActor actor, Guid org, CancellationToken ct, bool requireEnabled = true)
    {
        var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.Id == actor.Id, ct);
        var membership = await db.OrganizationMembers.AsNoTracking().SingleOrDefaultAsync(m => m.OrganizationId == org && m.UserId == actor.Id, ct);
        if (actor.OrganizationId != org || user is not { IsActive: true } || membership is null
            || actor.Admin != (membership.Role is OrganizationRole.Admin or OrganizationRole.Owner)
            || actor.CredentialVersion is not null && actor.CredentialVersion != Auth.SessionValidation.Fingerprint(user))
            throw new PracticeForbiddenException();
        if (requireEnabled && !await Enabled(org, ct)) throw new DomainException("Team Practice is not enabled for this organization.");
    }
    private async Task<bool> Enabled(Guid org, CancellationToken ct)
    {
        var setting = await db.Set<PracticeSetting>().FindAsync([org], ct);
        return setting?.Enabled ?? (configuration.GetSection("Practice:EnabledOrganizations").Get<string[]>() ?? []).Contains(org.ToString());
    }
    public async Task SetEnabled(Guid org, bool enabled, PracticeActor actor, CancellationToken ct)
    {
        await Check(actor, org, ct, false);
        if (!actor.Admin) throw new PracticeForbiddenException();
        var setting = await db.Set<PracticeSetting>().FindAsync([org], ct);
        if (setting is null) db.Add(new PracticeSetting { OrganizationId = org, Enabled = enabled });
        else setting.Enabled = enabled;
        await db.SaveChangesAsync(ct);
    }
    public async Task<object> Bootstrap(Guid org, PracticeActor actor, CancellationToken ct)
    {
        await Check(actor, org, ct, false);
        var enabled = await Enabled(org, ct);
        var seasons = await db.Seasons.Where(s => s.OrganizationId == org && s.Status == SeasonStatus.Active)
            .Select(s => new { s.Id, s.Name }).ToListAsync(ct);
        var players = enabled ? await db.Users.Where(u => u.IsActive && u.Kind == UserKind.Student
            && db.OrganizationMembers.Any(m => m.OrganizationId == org && m.UserId == u.Id))
            .Select(u => new { u.Id, u.DisplayName }).ToListAsync(ct) : [];
        var records = enabled ? await Rooms.Where(r => r.OrganizationId == org).ToListAsync(ct) : [];
        var states = records.Select(r => PracticeJson.Read<PracticeRoom>(r.StateJson)).ToList();
        var visible = states.Where(r => r.OwnerId == actor.Id || r.Members.Any(m => m.UserId == actor.Id) || actor.Admin && r.Submissions.Any(s => s.Appealed)
            || r.Invitations.Any(i => i.UserId == actor.Id && !i.Accepted && i.ExpiresAt > runtime.Now));
        var questions = actor.Admin && enabled ? await Questions.Where(q => q.OrganizationId == org).ToListAsync(ct) : [];
        return new
        {
            enabled,
            seasons,
            players,
            rooms = visible.Select(r => new { r.Id, r.SeasonId, r.TeamSize, r.QuestionCount, r.Coached, r.Status, memberCount = r.Members.Count, r.OwnerId }),
            invitations = states.SelectMany(r => r.Invitations).Where(i => i.UserId == actor.Id && !i.Accepted && i.ExpiresAt > runtime.Now),
            achievements = CalculateAwards(states).Where(a => a.UserId == actor.Id).DistinctBy(a => (a.Key, a.SeasonId)),
            trends = Trends(states, actor.Id),
            questions = questions.Select(q => new { q.Id, q.SeasonId, q.Published, question = PracticeJson.Read<PracticeQuestion>(q.DefinitionJson) })
        };
    }
    public async Task<object> Create(Guid org, PracticeActor actor, CreatePracticeRoom request, CancellationToken ct)
    {
        await Check(actor, org, ct);
        if (request.TeamSize is < 1 or > 5 || request.QuestionCount is not (10 or 30 or 90)) throw new DomainException("Choose 1–5 players and 10, 30, or 90 questions.");
        if (request.Coached && !actor.Admin) throw new DomainException("A non-playing coach must create a coached room.");
        if (!await db.Seasons.AnyAsync(s => s.Id == request.SeasonId && s.OrganizationId == org && s.Status == SeasonStatus.Active, ct)) throw new DomainException("Choose an active season.");
        var room = new PracticeRoom
        {
            SeasonId = request.SeasonId,
            TeamSize = request.TeamSize,
            QuestionCount = request.QuestionCount,
            OwnerId = actor.Id,
            CoachId = request.Coached ? actor.Id : null,
            Coached = request.Coached,
            BookKey = request.BookKey
        };
        var record = new PracticeRoomRecord { Id = room.Id, OrganizationId = org, SeasonId = room.SeasonId };
        db.Add(record);
        if (!actor.Admin) Join(room, actor, 1);
        await Save(record, room, ct);
        return View(room, actor);
    }
    private static void Join(PracticeRoom room, PracticeActor actor, int team)
    {
        if (room.Status != "Lobby" || team is not (1 or 2)) throw new DomainException("Choose a team in an open lobby.");
        if (actor.Admin) throw new DomainException("Coaches moderate rather than play.");
        if (room.Members.Any(m => m.UserId == actor.Id)) throw new DomainException("You are already in this room.");
        if (room.Members.Count(m => m.Team == team) >= room.TeamSize) throw new DomainException("That team is full.");
        var first = !room.Members.Any(m => m.Team == team);
        room.Members.Add(new PracticeMember { UserId = actor.Id, DisplayName = actor.Name, Team = team, Captain = first, Scribe = first });
        ResetReady(room);
    }
    private static void ResetReady(PracticeRoom room) { foreach (var m in room.Members) m.Ready = false; }
    private static void RepairRoles(PracticeRoom room)
    {
        foreach (var team in new[] { 1, 2 })
        {
            var members = room.Members.Where(m => m.Team == team).ToList();
            if (members.Count == 0) continue;
            if (!members.Any(m => m.Captain)) members[0].Captain = true;
            if (!members.Any(m => m.Scribe)) members[0].Scribe = true;
        }
    }
    private async Task Save(PracticeRoomRecord record, PracticeRoom room, CancellationToken ct)
    {
        if (room.Status == "Playing") runtime.Activate(room.Id); else runtime.Deactivate(room.Id);
        foreach (var member in room.Members)
        {
            var diagnostics = runtime.Telemetry.Current(member.UserId, room.Id);
            if (diagnostics is not null) room.TimingDiagnostics[member.UserId] = diagnostics;
        }
        room.Revision++;
        record.Revision = room.Revision;
        record.Status = room.Status;
        record.UpdatedAt = runtime.Now;
        record.StateJson = PracticeJson.Write(room);
        await db.SaveChangesAsync(ct);
    }
    private async Task<PracticeRoomRecord> Load(Guid org, Guid id, CancellationToken ct) =>
        await Rooms.SingleOrDefaultAsync(r => r.Id == id && r.OrganizationId == org, ct) ?? throw new DomainException("Room not found.");
    private static bool Member(PracticeRoom r, PracticeActor a) => r.OwnerId == a.Id || r.Members.Any(m => m.UserId == a.Id);
    public async Task<object> Snapshot(Guid org, Guid id, PracticeActor actor, CancellationToken ct)
    {
        await Check(actor, org, ct);
        using var lease = await runtime.Enter(id, ct);
        var record = await Load(org, id, ct);
        var room = PracticeJson.Read<PracticeRoom>(record.StateJson);
        if (!Member(room, actor) && !(actor.Admin && room.Submissions.Any(s => s.Appealed))) throw new PracticeForbiddenException();
        var changed = Advance(room);
        using var awards = room.Status == "Completed" ? await runtime.EnterAwards(room.SeasonId, ct) : null;
        if (room.Status == "Completed") { await ReconcileAwards(org, room, ct); changed = true; }
        if (changed) await Save(record, room, ct);
        return View(room, actor);
    }
    public async Task<object> Accept(Guid org, Guid invitationId, int? team, PracticeActor actor, CancellationToken ct)
    {
        await Check(actor, org, ct);
        var candidates = await Rooms.Where(r => r.OrganizationId == org && r.Status == "Lobby").AsNoTracking().ToListAsync(ct);
        var found = candidates.FirstOrDefault(r => PracticeJson.Read<PracticeRoom>(r.StateJson).Invitations.Any(i => i.Id == invitationId && i.UserId == actor.Id));
        if (found is null) throw new DomainException("Invitation not found.");
        using var lease = await runtime.Enter(found.Id, ct);
        var record = await Load(org, found.Id, ct);
        var room = PracticeJson.Read<PracticeRoom>(record.StateJson);
        var invitation = room.Invitations.Single(i => i.Id == invitationId && i.UserId == actor.Id);
        if (invitation.Accepted || invitation.ExpiresAt <= runtime.Now) throw new DomainException("Invitation is expired or already accepted.");
        Join(room, actor, invitation.Team ?? team ?? 1);
        invitation.Accepted = true;
        await Save(record, room, ct);
        return View(room, actor);
    }
    public async Task Import(Guid org, PracticeActor actor, ImportPracticeQuestions request, CancellationToken ct)
    {
        await Check(actor, org, ct);
        if (!actor.Admin) throw new PracticeForbiddenException();
        if (request.Questions is null || request.Questions.Count is < 1 or > 500) throw new DomainException("Import 1–500 questions at a time.");
        if (!await db.Seasons.AnyAsync(s => s.Id == request.SeasonId && s.OrganizationId == org, ct)) throw new DomainException("Season not found.");
        var pending = new List<PracticeQuestionRecord>();
        foreach (var question in request.Questions)
        {
            if (question is null) throw new DomainException("A question cannot be null.");
            var source = await db.SourceUnits.SingleOrDefaultAsync(u => u.Id == question.SourceUnitId && (u.OrganizationId == org && u.ContentPack!.OrganizationId == org || u.OrganizationId == BuiltInLibrary.OrganizationId && u.ContentPack!.OrganizationId == BuiltInLibrary.OrganizationId && u.ContentPack.IsBuiltIn) && u.ContentPackId == question.ContentPackId && u.IsActive && !u.IsRetired && u.ContentPack!.IsActive, ct);
            if (source is null || string.IsNullOrWhiteSpace(question.Evidence) || !source.CanonicalText.Contains(question.Evidence, StringComparison.OrdinalIgnoreCase))
                throw new DomainException("Each question needs evidence from an active approved source in this organization.");
            question.Reference = source.CitationLabel;
            if (question.Id == Guid.Empty) question.Id = Guid.NewGuid();
            try { PbeQuestionEvaluator.Validate(question); } catch (ArgumentException ex) { throw new DomainException(ex.Message); }
            if (question.Parts.Sum(p => p.Points) > 8) throw new DomainException("Questions must be worth 1–8 points.");
            var previous = await Questions.Where(q => q.OrganizationId == org && q.QuestionKey == question.Id).Select(q => q.Version).ToListAsync(ct);
            question.Version = previous.DefaultIfEmpty(0).Max() + 1;
            if (pending.Any(q => q.QuestionKey == question.Id)) throw new DomainException("Question keys must be unique within an import.");
            pending.Add(new PracticeQuestionRecord
            {
                Id = Guid.NewGuid(),
                OrganizationId = org,
                SeasonId = request.SeasonId,
                QuestionKey = question.Id,
                Version = question.Version,
                DefinitionJson = PracticeJson.Write(question)
            });
        }
        db.AddRange(pending);
        await db.SaveChangesAsync(ct);
    }
    public async Task Publish(Guid org, Guid id, PracticeActor actor, CancellationToken ct)
    {
        await Check(actor, org, ct);
        if (!actor.Admin) throw new PracticeForbiddenException();
        var row = await Questions.SingleOrDefaultAsync(q => q.OrganizationId == org && q.Id == id, ct) ?? throw new DomainException("Question not found.");
        row.Published = true;
        await db.SaveChangesAsync(ct);
    }
}
public sealed class PracticeForbiddenException : Exception;
