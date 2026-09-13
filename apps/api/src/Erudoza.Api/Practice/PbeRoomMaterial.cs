using System.Text.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Application.Study;
using Erudoza.Domain;
using Erudoza.Domain.Practice;
using Erudoza.Domain.Study;
using Microsoft.EntityFrameworkCore;
namespace Erudoza.Api.Practice;

public sealed partial class PracticeService
{
    private async Task<PbeSourceScope> AuthorizePbeRoom(Guid org, PracticeRoom room, CancellationToken ct, bool starting = false)
    {
        var season = await db.Seasons.AsNoTracking().SingleOrDefaultAsync(s => s.Id == room.SeasonId && s.OrganizationId == org, ct);
        if (season?.Status != SeasonStatus.Active) throw new DomainException("Choose an active season.");
        if ((starting || room.Status == "Lobby") && !season.PbeEnabled) throw new PracticeForbiddenException();
        var participants = room.Members.Select(m => m.UserId).ToArray();
        var eligible = await db.Users.Where(u => participants.Contains(u.Id) && u.IsActive && u.Kind == UserKind.Student && db.OrganizationMembers.Any(m => m.UserId == u.Id && m.OrganizationId == org && m.Role == OrganizationRole.Student) && db.CompetitionMembers.Any(m => m.UserId == u.Id && m.OrganizationId == org && m.SeasonId == room.SeasonId)).Select(u => u.Id).ToListAsync(ct);
        if (eligible.Count != participants.Length || participants.Distinct().Count() != participants.Length) throw new PracticeForbiddenException();
        var scope = await new Erudoza.Application.Content.CompetitionScopeResolver(db).ResolveAsync(org, room.SeasonId, ct);
        var units = await db.SourceUnits.AsNoTracking().Include(s => s.ContentPack).Where(s => scope.Contains(s.Id) && s.IsActive && !s.IsRetired && s.ContentPack!.IsActive && (s.OrganizationId == org && s.ContentPack.OrganizationId == org || s.OrganizationId == BuiltInLibrary.OrganizationId && s.ContentPack.OrganizationId == BuiltInLibrary.OrganizationId && s.ContentPack.IsBuiltIn)).ToListAsync(ct);
        var sources = units.Where(s => new[] { "approved", "public-domain", "creative-commons", "development-sample" }.Contains(s.ContentPack!.LicensingStatus.ToLowerInvariant())).Select(PbeSourceUnit.FromLegacy).ToList();
        var books = await db.ScopeEntries.Where(s => s.OrganizationId == org && s.SeasonId == room.SeasonId && s.Kind == ScopeEntryKind.Include).Select(s => s.BookKey).Distinct().ToListAsync(ct);
        var introductions = await db.PbeTrainingRecords.AsNoTracking().Where(r => r.OrganizationId == org && r.SeasonId == room.SeasonId && r.Kind == "pbe-introduction" && r.OwnerId == null).ToListAsync(ct);
        foreach (var row in introductions) { var intro = JsonSerializer.Deserialize<PbeIntroduction>(row.DataJson, PbeQuestionBank.Json)!; if (intro.OrganizationId == org && intro.SeasonId == room.SeasonId && intro.Reviewed && PbeSourceResolver.Licensed(intro.LicensingStatus) && books.Contains(intro.BookKey)) sources.AddRange(intro.Units.Select((u, i) => new PbeSourceUnit(u.Id, intro.Id, PbeSourceKind.Commentary, intro.BookKey, null, null, i + 1, u.Citation, u.CanonicalText))); }
        if (IsSimulation(room))
        {
            var assigned = new HashSet<Guid>();
            foreach (var participant in participants) assigned.UnionWith((await SimulationSources(org, room.SeasonId, participant, ct, !starting && room.Status == "Playing")).Sources.Select(s => s.Id));
            sources = sources.Where(s => assigned.Contains(s.Id)).ToList();
            sources = sources.Where(s => SimulationIncludes(room.Simulation!, s)).ToList();
        }
        if (!string.IsNullOrEmpty(room.BookKey)) sources = sources.Where(s => s.BookKey == room.BookKey).ToList();
        if (!starting && room.Questions.Count > 0) { var map = sources.ToDictionary(s => s.Id); foreach (var q in room.Questions) { if (q.Rubric is null || q.Rubric.SourceUnitIds.Any(id => !map.ContainsKey(id)) || PbeQuestionBank.SourceProof(q.Rubric, map) != room.SourceProofs.GetValueOrDefault(q.Id)) throw new PracticeForbiddenException(); } }
        return new(sources, JsonSerializer.Serialize(sources, PbeQuestionBank.Json));
    }
    private static IReadOnlySet<Guid> EligiblePbeReserves(PracticeRoom room, PbeSourceScope scope)
    {
        var sources = scope.Sources.ToDictionary(s => s.Id); var eligible = new HashSet<Guid>();
        foreach (var q in room.Reserves) { try { if (q.Rubric is not null && q.Rubric.SourceUnitIds.All(sources.ContainsKey) && PbeQuestionBank.SourceProof(q.Rubric, sources) == room.SourceProofs.GetValueOrDefault(q.Id)) eligible.Add(q.Id); } catch (DomainException) {/* A stale reserve is unavailable; selected questions still fail active authorization. */} }
        return eligible;
    }
    private static bool ValidPbeSet(IEnumerable<PbeQuestion> questions, int count) { var set = questions.ToList(); return set.Count == count && set.Select(q => q.Id).Distinct().Count() == count && set.Count(q => q.SourceKind == PbeSourceKind.Commentary) <= Math.Ceiling(count * .1) - 1 && set.Count(q => q.Kind == PbeQuestionKind.TrueFalse) <= count / 10; }
    private async Task SelectPbeRoomQuestions(Guid org, PracticeRoom room, CancellationToken ct)
    {
        var scope = await AuthorizePbeRoom(org, room, ct, true);
        var bank = await PbeQuestionBank.LoadAuthorizedSourcesAsync(db, new(org, room.SeasonId, null, scope.Sources.Select(s => s.Id).ToList()), scope, ct);
        var members = room.Members.Select(m => m.UserId).ToArray();
        var requested = members.SelectMany(m => bank.Questions.Select(q => $"{m}:{room.SeasonId}:{q.Id}")).ToArray();
        var records = await db.PbeTrainingRecords.AsNoTracking().Where(r => r.OrganizationId == org && r.SeasonId == room.SeasonId && r.Kind == "pbe-question-service" && r.OwnerId.HasValue && members.Contains(r.OwnerId.Value) && requested.Contains(r.Id)).ToListAsync(ct);
        var history = records.Select(r => JsonSerializer.Deserialize<PbeServiceProjection>(r.DataJson, PbeQuestionBank.Json)!).GroupBy(r => r.SubjectId).ToDictionary(g => g.Key, g => g.Max(r => r.ServedCount));
        var selected = PbeSelectionRules.Select(new(room.SelectionSeed, room.QuestionCount, "Simulation", bank.Questions.Select(q => new PbeSelectionCandidate(q.Id, [], q.SourceUnitIds, q.SourceKind.ToString(), q.Kind.ToString(), history.GetValueOrDefault(q.Id), null, false, false, history.GetValueOrDefault(q.Id))).ToList(), [], [], .1));
        if (selected.Count != room.QuestionCount) throw new DomainException($"This scope needs {room.QuestionCount} eligible questions; {selected.Count} satisfy the final-set quotas ({bank.Questions.Count} in the bank).");
        var chosen = selected.Select(id => bank.Questions.Single(q => q.Id == id)).ToList();
        var reserves = bank.Questions.Where(q => !selected.Contains(q.Id) && chosen.Select((_, i) => i).Any(i => ValidPbeSet(chosen.Select((old, n) => i == n ? q : old), room.QuestionCount))).ToList();
        if (reserves.Count == 0) throw new DomainException($"This scope needs {room.QuestionCount} questions plus a distinct eligible recovery reserve; {bank.Questions.Count} are available.");
        static PracticeQuestion Snapshot(PbeQuestion q) => new() { Id = q.Id, Version = q.Version, ContentPackId = q.ContentPackId, SourceUnitId = q.SourceUnitId, Reference = q.Reference, Evidence = q.Evidence, Kind = q.Kind.ToString(), Prompt = q.Prompt, Ordered = q.Ordered, Parts = q.Parts.Select(p => new AnswerPart { AcceptedAnswers = p.AcceptedAnswers, Points = p.Points }).ToList(), Rubric = q };
        room.Questions = chosen.Select(Snapshot).ToList(); room.Reserves = reserves.Take(1).Select(Snapshot).ToList(); var sources = scope.Sources.ToDictionary(s => s.Id); room.SourceProofs = chosen.Concat(reserves.Take(1)).ToDictionary(q => q.Id, q => PbeQuestionBank.SourceProof(q, sources));
        if ((await AuthorizePbeRoom(org, room, ct, true)).Fingerprint != scope.Fingerprint) throw new DomainException("Room material changed. Retry the start.");
    }
}
