using Erudoza.Application.Abstractions;
using Erudoza.Application.Assignments;
using Erudoza.Application.Content;
using Erudoza.Application.Study;
using Erudoza.Domain;
using Erudoza.Domain.Practice;
using Microsoft.EntityFrameworkCore;

namespace Erudoza.Api.Practice;

public sealed record SimulationChapter(string BookKey, int Chapter);
public sealed record SimulationSettings(int Version, string Preset, string[] BookKeys, SimulationChapter[] Chapters,
    bool IncludeScripture, bool IncludeIntroductions, double TimeMultiplier, bool HalfTime, string Discussion, Guid? AudioPresenterId = null, string? Scope = null);
public sealed record SimulationAvailabilityRequest(Guid SeasonId, int QuestionCount, int TeamSize, SimulationSettings Simulation, Guid? RoomId = null);

public sealed partial class PracticeService
{
    private static bool SelectedSimulationScope(SimulationSettings settings) => settings.Scope == "SelectedChapters" || settings.Scope is null && settings.Chapters.Length > 0;
    private static bool IsSimulation(PracticeRoom room) => IsPbe(room) && room.TeamCount == 1 && room.Simulation?.Version == 1;
    private sealed class SimulationUser(Guid org, Guid id) : ICurrentUser
    {
        public bool IsAuthenticated => true; public Guid UserId => id; public Guid OrganizationId => org;
        public UserKind Kind => UserKind.Student; public OrganizationRole Role => OrganizationRole.Student;
        public string DisplayName => ""; public bool IsAdmin => false; public bool IsStudent => true;
    }
    private async Task<PbeSourceScope> SimulationSources(Guid org, Guid season, Guid user, CancellationToken ct, bool continuation = false)
    {
        if (!await db.CompetitionMembers.AnyAsync(m => m.OrganizationId == org && m.SeasonId == season && m.UserId == user, ct)) throw new PracticeForbiddenException();
        var competition = new CompetitionScopeResolver(db);
        return await new PbeSourceResolver(db, new SimulationUser(org, user), competition, new StudentStudyScopeService(db, competition)).ResolveRoomSourcesAsync(org, season, user, continuation, ct);
    }
    private async Task ValidateSimulation(Guid org, PracticeRoom room, CancellationToken ct)
    {
        var s = room.Simulation ?? throw new DomainException("Simulation settings are required.");
        if (!IsSimulation(room) || room.Coached || s.Preset is not ("FullEvent" or "ShortPractice" or "Custom")
            || s.Scope is not (null or "AllAssigned" or "SelectedChapters")
            || s.Scope == "SelectedChapters" && (s.Chapters is null || s.Chapters.Length == 0 || s.BookKeys is null || s.BookKeys.Length == 0)
            || s.TimeMultiplier is not (1 or 1.5 or 2) || s.Discussion is not ("InPerson" or "Chat")
            || !s.IncludeScripture && !s.IncludeIntroductions || s.BookKeys is null || s.Chapters is null
            || s.BookKeys.Length > 66 || s.Chapters.Length > 1189 || s.Scope == "AllAssigned" && s.Chapters.Length != 0
            || s.BookKeys.Any(b => string.IsNullOrWhiteSpace(b) || !ScriptureCatalog.Books.Any(book => book.BookKey == b)) || s.BookKeys.Distinct().Count() != s.BookKeys.Length
            || s.Chapters.Any(c => c is null || c.Chapter is < 1 or > 150 || !s.BookKeys.Contains(c.BookKey)) || s.Chapters.Distinct().Count() != s.Chapters.Length
            || room.TeamSize is < 2 or > 6 || room.TeamSize < room.Members.Count || room.QuestionCount is not (10 or 30 or 90)
            || s.HalfTime && room.QuestionCount != 90
            || s.Preset == "FullEvent" && (room.QuestionCount != 90 || s.TimeMultiplier != 1 || !s.HalfTime)
            || s.Preset == "ShortPractice" && (room.QuestionCount == 90 || s.TimeMultiplier != 1 || s.HalfTime))
            throw new DomainException("Choose valid one-team simulation settings.");
        if (s.AudioPresenterId is null || (room.Members.Count == 0 ? s.AudioPresenterId != room.OwnerId : !room.Members.Any(m => m.UserId == s.AudioPresenterId)))
            throw new DomainException("Choose a current member as audio presenter.");
        var sources = new List<PbeSourceUnit>();
        foreach (var user in room.Members.Count == 0 ? new[] { room.OwnerId } : room.Members.Select(m => m.UserId)) sources.AddRange((await SimulationSources(org, room.SeasonId, user, ct)).Sources);
        if (SelectedSimulationScope(s) && (s.BookKeys.Any(b => !sources.Any(u => u.BookKey == b)) || s.Chapters.Any(c => !sources.Any(u => u.BookKey == c.BookKey && u.Chapter == c.Chapter))))
            throw new DomainException("Selected material is no longer available. Choose current books and chapters.");
    }
    private static bool SimulationIncludes(SimulationSettings s, PbeSourceUnit unit) =>
        (!SelectedSimulationScope(s) || s.BookKeys.Contains(unit.BookKey)) &&
        (unit.SourceKind == PbeSourceKind.Scripture ? s.IncludeScripture && (!SelectedSimulationScope(s) || s.Chapters.Any(c => c.BookKey == unit.BookKey && c.Chapter == unit.Chapter)) : s.IncludeIntroductions);
    public async Task<object> SimulationMaterial(Guid org, Guid season, PracticeActor actor, CancellationToken ct, Guid? roomId = null)
    {
        await Check(actor, org, ct);
        using var lease = roomId.HasValue ? await runtime.Enter(roomId.Value, ct) : null;
        if (actor.Admin) throw new PracticeForbiddenException();
        var sources = (await SimulationSources(org, season, actor.Id, ct)).Sources.ToList();
        if (roomId.HasValue)
        {
            var room = PracticeJson.Read<PracticeRoom>((await Load(org, roomId.Value, ct)).StateJson);
            if (!Member(room, actor) || !IsSimulation(room) || room.SeasonId != season) throw new PracticeForbiddenException();
            sources.Clear();
            foreach (var member in room.Members) sources.AddRange((await SimulationSources(org, season, member.UserId, ct)).Sources);
        }
        return new
        {
            seasonId = season,
            translation = BuiltInLibrary.TranslationId,
            books = sources.GroupBy(s => s.BookKey).OrderBy(g => g.Key).Select(g => new { key = g.Key, label = ScriptureCatalog.Books.SingleOrDefault(b => b.BookKey == g.Key)?.Name ?? g.Key, chapters = g.Where(s => s.Chapter.HasValue).Select(s => s.Chapter!.Value).Distinct().Order().ToArray() }),
            introductionsAvailable = sources.Any(s => s.SourceKind == PbeSourceKind.Commentary)
        };
    }
    public async Task<object> SimulationAvailability(Guid org, PracticeActor actor, SimulationAvailabilityRequest input, CancellationToken ct)
    {
        await Check(actor, org, ct);
        if (input.Simulation is null) throw new DomainException("Simulation settings are required.");
        using var lease = input.RoomId.HasValue ? await runtime.Enter(input.RoomId.Value, ct) : null;
        var room = input.RoomId.HasValue ? PracticeJson.Read<PracticeRoom>((await Load(org, input.RoomId.Value, ct)).StateJson) :
            new PracticeRoom { Format = "Pbe", TeamCount = 1, OwnerId = actor.Id, SeasonId = input.SeasonId, Members = [new() { UserId = actor.Id, Team = 1 }] };
        if (!Member(room, actor) || room.SeasonId != input.SeasonId || !IsPbe(room) || room.TeamCount != 1) throw new PracticeForbiddenException();
        room.Simulation = input.Simulation with { AudioPresenterId = input.Simulation.AudioPresenterId ?? room.OwnerId }; room.TeamSize = input.TeamSize; room.QuestionCount = input.QuestionCount;
        await ValidateSimulation(org, room, ct);
        var scope = await AuthorizePbeRoom(org, room, ct, true);
        var bank = await PbeQuestionBank.LoadAuthorizedSourcesAsync(db, new(org, room.SeasonId, null, scope.Sources.Select(s => s.Id).ToList()), scope, ct);
        string? reason = null;
        try { await SelectPbeRoomQuestions(org, room, ct); } catch (DomainException e) { reason = e.Message; }
        return new { eligibleQuestions = bank.Questions.Count, requestedQuestions = room.QuestionCount, canStart = reason is null, reason };
    }
}
