using System.Text.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Application.Contracts;
using Erudoza.Domain;
using Microsoft.EntityFrameworkCore;
namespace Erudoza.Application.Study;

public sealed record PbeMissionSnapshot(string Id, string Format, string RuleVersion, string ScoringVersion, string SelectionVersion, Guid SeasonId, Guid SessionId, string ScopeVersion, string LocalDate, string TimeZone, string Mode, int Target, int Completed);
/// <summary>Stages participation in the caller transaction, sharing Memory's calendar and preference revision, without invoking legacy mastery or Honors.</summary>
public sealed class PbeEffortService(IErudozaDbContext db)
{
    async Task<(TrainingPreference Row, TrainingPreferencesDto Preferences)> Touch(Guid org, Guid student, DateTimeOffset at, string? zone, CancellationToken ct)
    {
        if (zone is not null) TrainingCalendar.Validate(zone, 5);
        var row = await db.TrainingPreferences.SingleOrDefaultAsync(p => p.OrganizationId == org && p.StudentUserId == student, ct);
        if (row is null)
        {
            row = new() { OrganizationId = org, StudentUserId = student, PreferencesJson = JsonSerializer.Serialize(new TrainingPreferencesDto(zone ?? "UTC", 5, null), PbeQuestionBank.Json), LastEventAtUtc = at };
            db.TrainingPreferences.Add(row);
        }
        var prefs = TrainingCalendar.Effective(at, JsonSerializer.Deserialize<TrainingPreferencesDto>(row.PreferencesJson, PbeQuestionBank.Json)!);
        row.PreferencesJson = JsonSerializer.Serialize(prefs, PbeQuestionBank.Json);
        row.Revision++;
        if (at > row.LastEventAtUtc) row.LastEventAtUtc = at;
        return (row, prefs);
    }
    public async Task StartAsync(Guid org, PbeSessionSnapshot s, string? zone, CancellationToken ct)
    {
        var (_, p) = await Touch(org, s.StudentUserId, s.CreatedAtUtc, zone, ct);
        var c = TrainingCalendar.Resolve(s.CreatedAtUtc, p);
        s.MissionLocalDate = c.LocalDate;
        var mission = new PbeMissionSnapshot(s.Id.ToString(), "Pbe", s.RuleVersion, s.ScoringVersion, s.SelectionVersion, s.SeasonId, s.Id, s.ScopeVersion, c.LocalDate, c.TimeZone, s.Mode, s.Cards.Count, 0);
        PbeSessionService.Write(db, org, s, "pbe-daily-mission", s.Id.ToString(), mission);
        var headId = TrainingProgressService.Identity(org, s.StudentUserId, s.SeasonId.ToString(), c.LocalDate);
        var head = await db.PbeTrainingRecords.SingleOrDefaultAsync(r => r.OrganizationId == org && r.Kind == "pbe-daily-mission-head" && r.Id == headId, ct);
        PbeSessionService.Write(db, org, s, "pbe-daily-mission-head", headId, new { id = headId, format = "Pbe", missionId = s.Id, s.RuleVersion, s.ScoringVersion, s.SelectionVersion }, head);
    }
    public async Task ApplyAsync(Guid org, PbeSessionSnapshot s, DateTimeOffset at, CancellationToken ct)
    {
        var (_, p) = await Touch(org, s.StudentUserId, at, null, ct);
        var m = await db.PbeTrainingRecords.SingleAsync(r => r.OrganizationId == org && r.Kind == "pbe-daily-mission" && r.Id == s.Id.ToString(), ct);
        var mission = JsonSerializer.Deserialize<PbeMissionSnapshot>(m.DataJson, PbeQuestionBank.Json)!;
        PbeSessionService.Write(db, org, s, m.Kind, m.Id, mission with { Completed = s.Attempts.Count }, m);
        if (s.Cards.Count > 0 && s.Attempts.Count == s.Cards.Count && s.CreditedLocalDate is null)
        {
            var c = TrainingCalendar.Resolve(at, p);
            s.CreditedLocalDate = c.LocalDate;
            if (!await db.TrainingDays.AnyAsync(d => d.OrganizationId == org && d.StudentUserId == s.StudentUserId && d.LocalDate == c.LocalDate, ct))
            {
                s.NewlyCreditedDay = true;
                db.TrainingDays.Add(new() { OrganizationId = org, StudentUserId = s.StudentUserId, LocalDate = c.LocalDate, TimeZone = c.TimeZone, WeekStartLocalDate = c.WeekStartLocalDate, CreditedAtUtc = at, SessionId = s.Id });
                var week = await db.TrainingWeeks.SingleOrDefaultAsync(w => w.OrganizationId == org && w.StudentUserId == s.StudentUserId && w.WeekStartLocalDate == c.WeekStartLocalDate, ct);
                if (week is null)
                {
                    week = new() { OrganizationId = org, StudentUserId = s.StudentUserId, WeekStartLocalDate = c.WeekStartLocalDate, TimeZone = c.TimeZone, Target = p.WeeklyTarget };
                    db.TrainingWeeks.Add(week);
                }
                week.CompletedDays++;
                if (week.CompletedDays >= week.Target) week.QualifiedAtUtc ??= at;
            }
        }
    }
}
