using System.Text.Json;
using Erudoza.Application.Study;
using Microsoft.EntityFrameworkCore;
namespace Erudoza.Api.Practice;

public sealed partial class PracticeService
{
    private async Task<List<PracticeRoom>> OverlayRooms(Guid org, IReadOnlyList<PracticeRoom> rooms, CancellationToken ct)
    {
        var ids = rooms.Where(IsPbe).Select(r => $"Team:{r.Id}").ToArray(); if (ids.Length == 0) return rooms.ToList();
        var rows = await db.PbeTrainingRecords.AsNoTracking().Where(r => r.OrganizationId == org && r.Kind == "pbe-result-overlay" && ids.Contains(r.Id)).ToListAsync(ct);
        var overlays = rows.Select(r => JsonSerializer.Deserialize<PbeResultOverlay>(r.DataJson, PbeQuestionBank.Json)!).ToDictionary(r => r.Id);
        return rooms.Select(room =>
        {
            if (!IsPbe(room) || !overlays.TryGetValue($"Team:{room.Id}", out var overlay)) return room;
            var copy = PracticeJson.Read<PracticeRoom>(PracticeJson.Write(room));
            foreach (var s in copy.Submissions) { if (!overlay.Entries.TryGetValue(TeamAttemptId(copy, s), out var review)) continue; var q = copy.Questions.Single(q => q.Id == s.QuestionId); if (review.QuestionId != q.Id || review.QuestionVersion != q.Version) continue; s.Dispute = review; s.OriginalAccuracyHundredths = s.AccuracyHundredths; s.Resolved = review.Status == "Resolved"; if (review.PointsByPart is not null) s.AccuracyHundredths = review.PointsByPart.Sum() * 100; }
            return copy;
        }).ToList();
    }
    private async Task<object> PublicView(Guid org, PracticeRoom room, PracticeActor actor, CancellationToken ct, bool materialUnavailable = false) => View(materialUnavailable ? room : (await OverlayRooms(org, [room], ct))[0], actor, materialUnavailable);
}
