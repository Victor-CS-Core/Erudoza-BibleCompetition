using Erudoza.Application.Contracts;
using Erudoza.Domain;
namespace Erudoza.Application.Study;

public sealed record TrainingCalendarResult(string LocalDate, string WeekStartLocalDate, DateTimeOffset NextWeekAtUtc, string TimeZone);
public static class TrainingCalendar
{
    public static void Validate(string zone, int target)
    {
        if (target is not (3 or 4 or 5)) throw new DomainException("Choose a weekly target of 3, 4, or 5 days.");
        if (zone != "UTC" && !TimeZoneInfo.TryConvertIanaIdToWindowsId(zone, out _)) throw new DomainException("Choose a supported IANA timezone.");
        try { TimeZoneInfo.FindSystemTimeZoneById(zone); }
        catch (TimeZoneNotFoundException) { throw new DomainException("Choose a supported IANA timezone."); }
    }
    public static TrainingPreferencesDto Effective(DateTimeOffset now, TrainingPreferencesDto value) => value.Pending is { } pending && now >= pending.EffectiveAtUtc ? new(pending.TimeZone, pending.WeeklyTarget, null) : value;
    public static TrainingCalendarResult Resolve(DateTimeOffset now, TrainingPreferencesDto preferences)
    {
        preferences = Effective(now, preferences);
        Validate(preferences.TimeZone, preferences.WeeklyTarget);
        var zone = TimeZoneInfo.FindSystemTimeZoneById(preferences.TimeZone);
        var date = TimeZoneInfo.ConvertTime(now, zone).Date;
        var monday = date.AddDays(-(((int)date.DayOfWeek + 6) % 7));
        var next = DateTime.SpecifyKind(monday.AddDays(7), DateTimeKind.Unspecified);
        return new(date.ToString("yyyy-MM-dd"), monday.ToString("yyyy-MM-dd"), new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(next, zone)), preferences.TimeZone);
    }
}
